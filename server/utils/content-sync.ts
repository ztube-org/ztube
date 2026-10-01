import { database } from '../database/client.ts'
import { claimSyncJob, pruneSyncJobs, releaseSyncJob, resetSyncPages, saveSyncPage, syncJobs } from '../modules/content-sync-store.ts'
import type { SyncSource } from '../modules/content-sync-store.ts'
import { excludeUnsupportedVideos, isShortDuration } from '../modules/catalog.ts'
import { eq } from 'drizzle-orm'
import * as schema from '../database/schema.ts'
import { fetchChannelMetadata, fetchPlaylistMetadata, fetchPlaylistVideosPage, fetchVideoMetadata } from './youtube-api.ts'

const CONTENT_TTL_MS = 24 * 60 * 60 * 1000
// Below the Free plan's 50 external subrequests. Other scheduled services use a separate invocation.
// Four upload pages bound channel work to the newest 200 entries, before Shorts filtering.
const CHANNEL_PAGE_LIMIT = 4
const AUTO_REQUEST_BUDGET = 20
const MANUAL_REQUEST_BUDGET = 40

export type SyncTarget = { type: 'channel' | 'playlist' | 'video'; id: number }
export type SyncResult = { synced: number; skipped: number; failed: number; pending: number }

function freshEnough(lastFetchedAt: Date | null, instant: Date) {
  return lastFetchedAt !== null && instant.getTime() - lastFetchedAt.getTime() < CONTENT_TTL_MS
}

function syncError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('quota')) return 'YouTube API quota is exhausted; automatic retry scheduled'
  if (message.includes('API key')) return 'YouTube API key needs attention'
  if (/pagination|page.?token/i.test(message)) return 'YouTube pagination changed; restarting on the next sync'
  if (message.includes('subrequests')) return 'Sync request limit reached; automatic retry scheduled'
  return 'Sync failed; automatic retry scheduled'
}

export async function syncApprovedContent(env: Env, options: { target?: SyncTarget; force?: boolean; now?: Date } = {}): Promise<SyncResult> {
  const db = database(env.DB)
  const instant = options.now ?? new Date()
  const startedAt = Date.now()
  const result: SyncResult = { synced: 0, skipped: 0, failed: 0, pending: 0 }
  await pruneSyncJobs(env.DB)
  const channels = options.target && options.target.type !== 'channel'
    ? [] : await db.query.allowedChannels.findMany({ where: options.target ? eq(schema.allowedChannels.id, options.target.id) : undefined })
  const playlists = options.target && options.target.type !== 'playlist'
    ? [] : await db.query.allowedPlaylists.findMany({ where: options.target ? eq(schema.allowedPlaylists.id, options.target.id) : undefined })
  const videos = options.target && options.target.type !== 'video'
    ? [] : await db.query.allowedVideos.findMany({ where: options.target ? eq(schema.allowedVideos.id, options.target.id) : undefined })
  const jobs = new Map((await syncJobs(env.DB)).map(job => [`${job.kind}:${job.external_id}`, job]))
  type Source = SyncSource & { lastFetchedAt: Date | null; nextPageToken: string | null }
  const unique = new Map<string, Source>()
  const sources: Source[] = [
    ...channels.map(item => ({ kind: 'channel' as const, externalId: item.channelId, lastFetchedAt: item.lastFetchedAt, nextPageToken: item.nextPageToken })),
    ...playlists.filter(item => !item.playlistId.startsWith('pl:')).map(item => ({ kind: 'playlist' as const, externalId: item.playlistId, lastFetchedAt: item.lastFetchedAt, nextPageToken: item.nextPageToken })),
    ...videos.filter(item => !/^(ol|jf):/.test(item.videoId)).map(item => ({ kind: 'video' as const, externalId: item.videoId, lastFetchedAt: item.lastFetchedAt, nextPageToken: null })),
  ]
  for (const source of sources) {
    const key = `${source.kind}:${source.externalId}`
    const prior = unique.get(key)
    // A newly approved Child must not be hidden behind another Child's fresh copy.
    if (!prior || (source.lastFetchedAt?.getTime() ?? 0) < (prior.lastFetchedAt?.getTime() ?? 0) || source.nextPageToken) unique.set(key, source)
  }
  const keyOf = (source: SyncSource) => `${source.kind}:${source.externalId}`
  const queue = [...unique.values()].filter(source => {
    const job = jobs.get(keyOf(source))
    if (!options.force && !job?.page_count && !job?.last_error && !source.nextPageToken && freshEnough(source.lastFetchedAt, instant)) { result.skipped++; return false }
    return true
  }).sort((a, b) => (jobs.get(keyOf(a))?.last_attempt_at ?? 0) - (jobs.get(keyOf(b))?.last_attempt_at ?? 0))
  const pending = new Set(queue.map(keyOf))
  // Each heartbeat works on at most one source, including when it fails.
  // Keep the full pending count so deferred work remains visible in the summary.
  queue.splice(1)
  let remaining = options.target ? MANUAL_REQUEST_BUDGET : AUTO_REQUEST_BUDGET
  // Persisted attempt times rotate unfinished and failed sources between heartbeats.
  while (queue.length && remaining >= 3 && Date.now() - startedAt < 20_000) {
    const source = queue.shift()!
    const job = await claimSyncJob(env.DB, source, instant)
    if (!job) continue
    try {
      if (source.kind === 'video') {
        remaining--
        const video = await fetchVideoMetadata(source.externalId, env.YOUTUBE_API_KEY)
        const update = await env.DB.prepare(`UPDATE allowed_videos SET video_title = ?, video_description = ?, video_thumbnail = ?,
          duration = ?, channel_title = ?, published_at = ?, last_fetched_at = ?, is_available = ?
          WHERE video_id = ? AND EXISTS (SELECT 1 FROM content_sync_jobs WHERE kind = 'video' AND external_id = ? AND lease_token = ?)`)
          .bind(video.title, video.description, video.thumbnail, video.duration, video.channelTitle,
            video.publishedAt ? Math.floor(video.publishedAt.getTime() / 1000) : null, Math.floor(instant.getTime() / 1000),
            Number(video.embeddable && !isShortDuration(video.duration)), source.externalId, source.externalId, job.lease_token).run()
        await releaseSyncJob(env.DB, job)
        if (update.meta.changes) { pending.delete(keyOf(source)); result.synced++ }
        continue
      }
      // Discard a cursor left beyond the new window by a pre-cap deployment.
      if (source.kind === 'channel' && job.page_count >= CHANNEL_PAGE_LIMIT) {
        await resetSyncPages(env.DB, job)
        Object.assign(job, { page_count: 0, page_token: null, playlist_id: null, title: null, thumbnail: null })
      }
      // A page uses at most two requests; only the first page needs metadata.
      remaining -= job.playlist_id ? 2 : 3
      const metadata = job.playlist_id
        ? { title: job.title!, thumbnail: job.thumbnail!, uploadsPlaylistId: job.playlist_id }
        : source.kind === 'channel'
          ? await fetchChannelMetadata(source.externalId, env.YOUTUBE_API_KEY)
          : await fetchPlaylistMetadata(source.externalId, env.YOUTUBE_API_KEY)
      const playlistId = 'uploadsPlaylistId' in metadata ? metadata.uploadsPlaylistId : source.externalId
      const page = await fetchPlaylistVideosPage(playlistId, env.YOUTUBE_API_KEY, job.page_token ?? undefined)
      const nextPageToken = source.kind === 'channel' && job.page_count + 1 >= CHANNEL_PAGE_LIMIT ? null : page.nextPageToken
      const saved = await saveSyncPage(env.DB, job, { videos: excludeUnsupportedVideos(page.videos).videos,
        nextPageToken, playlistId, title: metadata.title, thumbnail: metadata.thumbnail }, instant)
      if (!saved) continue // A newer lease owns this job; never publish the stale fetch.
      if (nextPageToken) queue.push(source)
      else { pending.delete(keyOf(source)); result.synced++ }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (/pagination|page.?token/i.test(message)) await resetSyncPages(env.DB, job)
      const reason = syncError(error)
      await releaseSyncJob(env.DB, job, reason)
      pending.delete(keyOf(source))
      result.failed++
      const detail = (env.YOUTUBE_API_KEY ? message.replaceAll(env.YOUTUBE_API_KEY, '[redacted]') : message).replace(/https?:\/\/\S+/g, '[upstream URL]').slice(0, 500)
      console.error(JSON.stringify({ event: 'approved_content_sync_failed', type: source.kind, id: source.externalId, message: reason, detail }))
    }
  }
  result.pending = pending.size
  return result
}
