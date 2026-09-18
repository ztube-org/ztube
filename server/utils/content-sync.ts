import { database } from '../database/client.ts'
import { writeContentCache } from '../modules/content-cache.ts'
import { excludeUnsupportedVideos, isShortDuration } from '../modules/catalog.ts'
import { eq } from 'drizzle-orm'
import * as schema from '../database/schema.ts'
import { fetchChannelMetadata, fetchPlaylistMetadata, fetchPlaylistVideosPage, fetchVideoMetadata } from './youtube-api.ts'

const CONTENT_TTL_MS = 6 * 60 * 60 * 1000

export type SyncTarget =
  | { type: 'channel'; id: number }
  | { type: 'playlist'; id: number }
  | { type: 'video'; id: number }

export type SyncResult = { synced: number; skipped: number; failed: number }

function freshEnough(lastFetchedAt: Date | null, instant: Date) {
  return lastFetchedAt !== null && instant.getTime() - lastFetchedAt.getTime() < CONTENT_TTL_MS
}

async function fetchCompletePlaylist(playlistId: string, apiKey: string) {
  const videos: Awaited<ReturnType<typeof fetchPlaylistVideosPage>>['videos'] = []
  let pageToken: string | null | undefined
  const seen = new Set<string>()
  do {
    if (seen.has(pageToken ?? '')) throw new Error('YouTube pagination did not advance')
    seen.add(pageToken ?? '')
    const page = await fetchPlaylistVideosPage(playlistId, apiKey, pageToken ?? undefined)
    videos.push(...page.videos)
    pageToken = page.nextPageToken
  } while (pageToken)
  return { videos, nextPageToken: null as string | null }
}

export async function syncApprovedContent(env: Env, options: { target?: SyncTarget; force?: boolean; now?: Date } = {}): Promise<SyncResult> {
  const db = database(env.DB)
  const instant = options.now ?? new Date()
  const result: SyncResult = { synced: 0, skipped: 0, failed: 0 }
  const channels = options.target && options.target.type !== 'channel'
    ? []
    : await db.query.allowedChannels.findMany({ where: options.target ? eq(schema.allowedChannels.id, options.target.id) : undefined })
  const playlists = options.target && options.target.type !== 'playlist'
    ? []
    : await db.query.allowedPlaylists.findMany({ where: options.target ? eq(schema.allowedPlaylists.id, options.target.id) : undefined })
  const videos = options.target && options.target.type !== 'video'
    ? []
    : await db.query.allowedVideos.findMany({ where: options.target ? eq(schema.allowedVideos.id, options.target.id) : undefined })

  const sources = [
    ...channels.map(item => ({ kind: 'channel' as const, externalId: item.channelId, lastFetchedAt: item.lastFetchedAt, nextPageToken: item.nextPageToken })),
    ...playlists.filter(item => !item.playlistId.startsWith('pl:')).map(item => ({ kind: 'playlist' as const, externalId: item.playlistId, lastFetchedAt: item.lastFetchedAt, nextPageToken: item.nextPageToken })),
  ]
  const visited = new Set<string>()
  for (const source of sources) {
    const key = `${source.kind}:${source.externalId}`
    if (visited.has(key)) continue
    visited.add(key)
    if (!options.force && !source.nextPageToken && freshEnough(source.lastFetchedAt, instant)) { result.skipped++; continue }
    try {
      const metadata = source.kind === 'channel'
        ? await fetchChannelMetadata(source.externalId, env.YOUTUBE_API_KEY)
        : await fetchPlaylistMetadata(source.externalId, env.YOUTUBE_API_KEY)
      const uploadsPlaylistId = 'uploadsPlaylistId' in metadata ? metadata.uploadsPlaylistId : undefined
      const page = await fetchCompletePlaylist(uploadsPlaylistId ?? source.externalId, env.YOUTUBE_API_KEY)
      const accepted = excludeUnsupportedVideos(page.videos).videos
      await writeContentCache(env.DB, source, accepted, { replace: true, nextPageToken: null, instant,
        title: metadata.title, thumbnail: metadata.thumbnail, uploadsPlaylistId })
      result.synced++
    } catch (error) {
      result.failed++
      console.error(JSON.stringify({ event: 'approved_content_sync_failed', type: source.kind, message: error instanceof Error ? error.message : String(error) }))
    }
  }

  const visitedVideos = new Set<string>()
  for (const item of videos) {
    if (/^(ol|jf):/.test(item.videoId)) { result.skipped++; continue }
    if (visitedVideos.has(item.videoId)) continue
    visitedVideos.add(item.videoId)
    if (!options.force && freshEnough(item.lastFetchedAt, instant)) { result.skipped++; continue }
    try {
      const video = await fetchVideoMetadata(item.videoId, env.YOUTUBE_API_KEY)
      await db.update(schema.allowedVideos).set({
        videoTitle: video.title, videoDescription: video.description, videoThumbnail: video.thumbnail,
        duration: video.duration, channelTitle: video.channelTitle, publishedAt: video.publishedAt,
        lastFetchedAt: instant, isAvailable: video.embeddable && !isShortDuration(video.duration),
      }).where(eq(schema.allowedVideos.videoId, item.videoId))
      result.synced++
    } catch (error) {
      result.failed++
      console.error(JSON.stringify({ event: 'approved_content_sync_failed', type: 'video', id: item.id, message: error instanceof Error ? error.message : String(error) }))
    }
  }
  return result
}
