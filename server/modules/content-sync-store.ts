import type { VideoMetadata } from '../utils/youtube-api.ts'

export type SyncSource = { kind: 'channel' | 'playlist' | 'video'; externalId: string }
export type SyncJob = {
  kind: SyncSource['kind']; external_id: string; page_token: string | null; page_count: number
  playlist_id: string | null; title: string | null; thumbnail: string | null
  last_attempt_at: number; last_error: string | null; lease_token: string | null; lease_until: number
}

export async function syncJobs(db: D1Database) {
  return (await db.prepare('SELECT * FROM content_sync_jobs').all<SyncJob>()).results
}

export async function pruneSyncJobs(db: D1Database) {
  await db.prepare(`DELETE FROM content_sync_jobs WHERE
    (kind = 'channel' AND NOT EXISTS (SELECT 1 FROM allowed_channels WHERE channel_id = external_id)) OR
    (kind = 'playlist' AND NOT EXISTS (SELECT 1 FROM allowed_playlists WHERE playlist_id = external_id)) OR
    (kind = 'video' AND NOT EXISTS (SELECT 1 FROM allowed_videos WHERE video_id = external_id))`).run()
}

// A lease fences overlapping manual/Cron invocations. A terminated Worker can be retried.
export async function claimSyncJob(db: D1Database, source: SyncSource, instant: Date) {
  return db.prepare(`INSERT INTO content_sync_jobs (kind, external_id, last_attempt_at, lease_token, lease_until)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(kind, external_id) DO UPDATE SET
      last_attempt_at = excluded.last_attempt_at, lease_token = excluded.lease_token, lease_until = excluded.lease_until
    WHERE content_sync_jobs.lease_until <= ? RETURNING *`)
    .bind(source.kind, source.externalId, instant.getTime(), crypto.randomUUID(), instant.getTime() + 120_000, instant.getTime()).first<SyncJob>()
}

function fence(job: SyncJob) {
  return { sql: 'EXISTS (SELECT 1 FROM content_sync_jobs WHERE kind = ? AND external_id = ? AND lease_token = ?)', args: [job.kind, job.external_id, job.lease_token] }
}

export async function releaseSyncJob(db: D1Database, job: SyncJob, error: string | null = null) {
  await db.prepare(`UPDATE content_sync_jobs SET lease_token = NULL, lease_until = 0, last_error = ?
    WHERE kind = ? AND external_id = ? AND lease_token = ?`).bind(error, job.kind, job.external_id, job.lease_token).run()
}

export async function saveSyncPage(db: D1Database, job: SyncJob, page: {
  videos: VideoMetadata[]; nextPageToken: string | null; playlistId: string; title: string; thumbnail: string
}, instant: Date) {
  const guard = fence(job)
  // Store one bounded page at a time. SQL publishes the staged snapshot without loading it into Worker memory.
  const videos = page.videos.map((v, i) => ({ ...v, position: job.page_count * 50 + i,
    publishedAt: v.publishedAt ? Math.floor(v.publishedAt.getTime() / 1000) : null }))
  const statements = [db.prepare(`INSERT INTO content_sync_pages (kind, external_id, page_number, request_token, videos)
    SELECT ?, ?, ?, ?, ? WHERE ${guard.sql}`).bind(job.kind, job.external_id, job.page_count, job.page_token ?? '', JSON.stringify(videos), ...guard.args)]
  if (page.nextPageToken) {
    // Detect token cycles across invocations, not only within the current Worker.
    const repeated = page.nextPageToken === job.page_token || await db.prepare(`SELECT 1 AS found FROM content_sync_pages
      WHERE kind = ? AND external_id = ? AND request_token = ?`).bind(job.kind, job.external_id, page.nextPageToken).first()
    if (repeated) throw new Error('YouTube pagination did not advance')
    statements.push(db.prepare(`UPDATE content_sync_jobs SET page_token = ?, page_count = page_count + 1,
      playlist_id = ?, title = ?, thumbnail = ?, last_error = NULL, lease_token = NULL, lease_until = 0
      WHERE kind = ? AND external_id = ? AND lease_token = ?`)
      .bind(page.nextPageToken, page.playlistId, page.title, page.thumbnail, ...guard.args))
  } else {
    const table = job.kind === 'channel' ? 'channel_videos' : 'playlist_videos'
    const approvals = job.kind === 'channel' ? 'allowed_channels' : 'allowed_playlists'
    const key = job.kind === 'channel' ? 'channel_id' : 'playlist_id'
    const epoch = Math.floor(instant.getTime() / 1000)
    statements.push(db.prepare(`DELETE FROM ${table} WHERE ${key} = ? AND ${guard.sql}`).bind(job.external_id, ...guard.args))
    statements.push(db.prepare(`INSERT INTO "${table}" (${key}, video_id, position, video_title, video_description, video_thumbnail, duration, channel_title, published_at, fetched_at)
      SELECT ?, json_extract(v.value, '$.videoId'), json_extract(v.value, '$.position'), json_extract(v.value, '$.title'),
        json_extract(v.value, '$.description'), json_extract(v.value, '$.thumbnail'), json_extract(v.value, '$.duration'),
        json_extract(v.value, '$.channelTitle'), json_extract(v.value, '$.publishedAt'), ?
      FROM content_sync_pages p, json_each(p.videos) v
      WHERE p.kind = ? AND p.external_id = ? AND ${guard.sql}
      ORDER BY p.page_number, v.key
      ON CONFLICT (${key}, video_id) DO UPDATE SET position = excluded.position, video_title = excluded.video_title,
        video_description = excluded.video_description, video_thumbnail = excluded.video_thumbnail, duration = excluded.duration,
        channel_title = excluded.channel_title, published_at = excluded.published_at, fetched_at = excluded.fetched_at`)
      .bind(job.external_id, epoch, job.kind, job.external_id, ...guard.args))
    statements.push(db.prepare(`UPDATE ${approvals} SET last_fetched_at = ?, next_page_token = NULL, is_available = 1,
      ${job.kind}_title = ?, ${job.kind}_thumbnail = ? ${job.kind === 'channel' ? ', uploads_playlist_id = ?' : ''}
      WHERE ${key} = ? AND ${guard.sql}`).bind(epoch, page.title, page.thumbnail,
      ...(job.kind === 'channel' ? [page.playlistId] : []), job.external_id, ...guard.args))
    statements.push(db.prepare(`DELETE FROM content_sync_pages WHERE kind = ? AND external_id = ? AND ${guard.sql}`)
      .bind(job.kind, job.external_id, ...guard.args))
    statements.push(db.prepare(`UPDATE content_sync_jobs SET page_count = 0, page_token = NULL, playlist_id = NULL,
      title = NULL, thumbnail = NULL, last_error = NULL, lease_token = NULL, lease_until = 0
      WHERE kind = ? AND external_id = ? AND lease_token = ?`).bind(...guard.args))
  }
  const results = await db.batch(statements)
  return results[results.length - 1].meta.changes > 0
}

export async function resetSyncPages(db: D1Database, job: SyncJob) {
  const guard = fence(job)
  await db.batch([
    db.prepare(`DELETE FROM content_sync_pages WHERE kind = ? AND external_id = ? AND ${guard.sql}`).bind(job.kind, job.external_id, ...guard.args),
    db.prepare(`UPDATE content_sync_jobs SET page_count = 0, page_token = NULL, playlist_id = NULL WHERE kind = ? AND external_id = ? AND lease_token = ?`).bind(...guard.args),
  ])
}
