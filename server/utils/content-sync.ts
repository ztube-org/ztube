import { and, count, eq, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
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

function shortVideo(duration: number | null) {
  return duration !== null && duration <= 180
}

export async function syncApprovedContent(env: Env, options: { target?: SyncTarget; force?: boolean; now?: Date } = {}): Promise<SyncResult> {
  const db = drizzle(env.DB, { schema })
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

  for (const item of channels) {
    const pageToken = options.force ? null : item.nextPageToken
    if (!options.force && !pageToken && freshEnough(item.lastFetchedAt, instant)) { result.skipped++; continue }
    try {
      const metadata = !pageToken ? await fetchChannelMetadata(item.channelId, env.YOUTUBE_API_KEY) : null
      const uploadsPlaylistId = metadata?.uploadsPlaylistId ?? item.uploadsPlaylistId
      const page = await fetchPlaylistVideosPage(uploadsPlaylistId, env.YOUTUBE_API_KEY, pageToken ?? undefined)
      const accepted = page.videos.filter(video => !shortVideo(video.duration))
      const rejectedIds = page.videos.filter(video => shortVideo(video.duration)).map(video => video.videoId)
      if (!pageToken) await db.delete(schema.channelVideos).where(eq(schema.channelVideos.channelId, item.channelId))
      else if (rejectedIds.length) await db.delete(schema.channelVideos).where(and(eq(schema.channelVideos.channelId, item.channelId), inArray(schema.channelVideos.videoId, rejectedIds)))
      const existing = pageToken ? await db.select({ count: count() }).from(schema.channelVideos).where(eq(schema.channelVideos.channelId, item.channelId)).get() : null
      const positionOffset = existing?.count ?? 0
      for (let offset = 0; offset < accepted.length; offset += 10) {
        const rows = accepted.slice(offset, offset + 10).map((video, index) => ({
          channelId: item.channelId, videoId: video.videoId, position: positionOffset + offset + index,
          videoTitle: video.title, videoDescription: video.description, videoThumbnail: video.thumbnail,
          duration: video.duration, channelTitle: video.channelTitle, publishedAt: video.publishedAt, fetchedAt: instant,
        }))
        if (rows.length) await db.insert(schema.channelVideos).values(rows).onConflictDoUpdate({
          target: [schema.channelVideos.channelId, schema.channelVideos.videoId],
          set: {
            position: sql`excluded.position`, videoTitle: sql`excluded.video_title`, videoDescription: sql`excluded.video_description`,
            videoThumbnail: sql`excluded.video_thumbnail`, duration: sql`excluded.duration`, channelTitle: sql`excluded.channel_title`,
            publishedAt: sql`excluded.published_at`, fetchedAt: sql`excluded.fetched_at`,
          },
        })
      }
      await db.update(schema.allowedChannels).set({
        uploadsPlaylistId, channelTitle: metadata?.title ?? item.channelTitle, channelThumbnail: metadata?.thumbnail ?? item.channelThumbnail,
        nextPageToken: page.nextPageToken, lastFetchedAt: instant, isAvailable: true,
      }).where(eq(schema.allowedChannels.id, item.id))
      result.synced++
    } catch (error) {
      result.failed++
      console.error(JSON.stringify({ event: 'approved_content_sync_failed', type: 'channel', id: item.id, message: error instanceof Error ? error.message : String(error) }))
    }
  }

  for (const item of playlists) {
    const pageToken = options.force ? null : item.nextPageToken
    if (!options.force && !pageToken && freshEnough(item.lastFetchedAt, instant)) { result.skipped++; continue }
    try {
      const metadata = !pageToken ? await fetchPlaylistMetadata(item.playlistId, env.YOUTUBE_API_KEY) : null
      const page = await fetchPlaylistVideosPage(item.playlistId, env.YOUTUBE_API_KEY, pageToken ?? undefined)
      const accepted = page.videos.filter(video => !shortVideo(video.duration))
      const rejectedIds = page.videos.filter(video => shortVideo(video.duration)).map(video => video.videoId)
      if (!pageToken) await db.delete(schema.playlistVideos).where(eq(schema.playlistVideos.playlistId, item.playlistId))
      else if (rejectedIds.length) await db.delete(schema.playlistVideos).where(and(eq(schema.playlistVideos.playlistId, item.playlistId), inArray(schema.playlistVideos.videoId, rejectedIds)))
      const existing = pageToken ? await db.select({ count: count() }).from(schema.playlistVideos).where(eq(schema.playlistVideos.playlistId, item.playlistId)).get() : null
      const positionOffset = existing?.count ?? 0
      for (let offset = 0; offset < accepted.length; offset += 10) {
        const rows = accepted.slice(offset, offset + 10).map((video, index) => ({
          playlistId: item.playlistId, videoId: video.videoId, position: positionOffset + offset + index,
          videoTitle: video.title, videoDescription: video.description, videoThumbnail: video.thumbnail,
          duration: video.duration, channelTitle: video.channelTitle, publishedAt: video.publishedAt, fetchedAt: instant,
        }))
        if (rows.length) await db.insert(schema.playlistVideos).values(rows).onConflictDoUpdate({
          target: [schema.playlistVideos.playlistId, schema.playlistVideos.videoId],
          set: {
            position: sql`excluded.position`, videoTitle: sql`excluded.video_title`, videoDescription: sql`excluded.video_description`,
            videoThumbnail: sql`excluded.video_thumbnail`, duration: sql`excluded.duration`, channelTitle: sql`excluded.channel_title`,
            publishedAt: sql`excluded.published_at`, fetchedAt: sql`excluded.fetched_at`,
          },
        })
      }
      await db.update(schema.allowedPlaylists).set({
        playlistTitle: metadata?.title ?? item.playlistTitle, playlistThumbnail: metadata?.thumbnail ?? item.playlistThumbnail,
        nextPageToken: page.nextPageToken, lastFetchedAt: instant, isAvailable: true,
      }).where(eq(schema.allowedPlaylists.id, item.id))
      result.synced++
    } catch (error) {
      result.failed++
      console.error(JSON.stringify({ event: 'approved_content_sync_failed', type: 'playlist', id: item.id, message: error instanceof Error ? error.message : String(error) }))
    }
  }

  for (const item of videos) {
    if (!options.force && freshEnough(item.lastFetchedAt, instant)) { result.skipped++; continue }
    try {
      const video = await fetchVideoMetadata(item.videoId, env.YOUTUBE_API_KEY)
      await db.update(schema.allowedVideos).set({
        videoTitle: video.title, videoDescription: video.description, videoThumbnail: video.thumbnail,
        duration: video.duration, channelTitle: video.channelTitle, publishedAt: video.publishedAt,
        lastFetchedAt: instant, isAvailable: !shortVideo(video.duration),
      }).where(eq(schema.allowedVideos.id, item.id))
      result.synced++
    } catch (error) {
      result.failed++
      console.error(JSON.stringify({ event: 'approved_content_sync_failed', type: 'video', id: item.id, message: error instanceof Error ? error.message : String(error) }))
    }
  }
  return result
}
