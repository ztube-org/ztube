import type { VideoMetadata } from '../utils/youtube-api.ts'
import { epochSeconds } from '../utils/viewing-day.ts'

export type ContentSource = { kind: 'channel' | 'playlist'; externalId: string }

// One transaction publishes both membership and freshness for every Child
// sharing this source. No reader can observe a deleted or half-written cache.
export async function writeContentCache(binding: D1Database, source: ContentSource, videos: VideoMetadata[], options: {
  replace: boolean
  rejectedVideoIds?: string[]
  positionOffset?: number
  nextPageToken: string | null
  instant: Date
  title?: string
  thumbnail?: string
  uploadsPlaylistId?: string
}) {
  const table = source.kind === 'channel' ? 'channel_videos' : 'playlist_videos'
  const approvals = source.kind === 'channel' ? 'allowed_channels' : 'allowed_playlists'
  const key = source.kind === 'channel' ? 'channel_id' : 'playlist_id'
  const statements: D1PreparedStatement[] = []
  if (options.replace) statements.push(binding.prepare(`DELETE FROM ${table} WHERE ${key} = ?`).bind(source.externalId))
  else {
    const rejected = options.rejectedVideoIds ?? []
    for (let offset = 0; offset < rejected.length; offset += 90) {
      const chunk = rejected.slice(offset, offset + 90)
      statements.push(binding.prepare(`DELETE FROM ${table} WHERE ${key} = ? AND video_id IN (${chunk.map(() => '?').join(',')})`).bind(source.externalId, ...chunk))
    }
  }
  for (let offset = 0; offset < videos.length; offset += 10) {
    const chunk = videos.slice(offset, offset + 10)
    statements.push(binding.prepare(`
      INSERT INTO "${table}" (${key}, video_id, position, video_title, video_description, video_thumbnail, duration, channel_title, published_at, fetched_at)
      VALUES ${chunk.map(() => '(?,?,?,?,?,?,?,?,?,?)').join(',')}
      ON CONFLICT (${key}, video_id) DO UPDATE SET position = excluded.position,
        video_title = excluded.video_title, video_description = excluded.video_description,
        video_thumbnail = excluded.video_thumbnail, duration = excluded.duration,
        channel_title = excluded.channel_title, published_at = excluded.published_at, fetched_at = excluded.fetched_at
    `.trim()).bind(...chunk.flatMap((video, index) => [source.externalId, video.videoId, (options.positionOffset ?? 0) + offset + index,
      video.title, video.description, video.thumbnail, video.duration, video.channelTitle,
      video.publishedAt ? epochSeconds(video.publishedAt) : null, epochSeconds(options.instant)])))
  }
  statements.push(binding.prepare(`UPDATE ${approvals} SET last_fetched_at = ?, next_page_token = ?, is_available = 1,
    ${source.kind}_title = COALESCE(?, ${source.kind}_title), ${source.kind}_thumbnail = COALESCE(?, ${source.kind}_thumbnail)
    ${source.kind === 'channel' ? ', uploads_playlist_id = COALESCE(?, uploads_playlist_id)' : ''}
    WHERE ${key} = ?`).bind(epochSeconds(options.instant), options.nextPageToken, options.title ?? null, options.thumbnail ?? null,
      ...(source.kind === 'channel' ? [options.uploadsPlaylistId ?? null] : []), source.externalId))
  await binding.batch(statements)
}
