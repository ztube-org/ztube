import { eq, and } from 'drizzle-orm'
import { db } from '../../../../database'
import { allowedPlaylists, playlistVideos } from '../../../../database/schema'
import { requireRole } from '../../../../utils/auth'
import { fetchPlaylistVideos } from '../../../../utils/youtube-api'

const STALE_HOURS = 6

export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['child'])
  const playlistDbId = parseInt(getRouterParam(event, 'id') || '0')

  // Get playlist and verify access
  const playlist = await db.query.allowedPlaylists.findFirst({
    where: and(eq(allowedPlaylists.id, playlistDbId), eq(allowedPlaylists.childId, user.id!)),
  })

  if (!playlist) {
    throw createError({ statusCode: 404, message: 'Playlist not found' })
  }

  // Check if cache is stale
  const now = new Date()
  const lastFetched = playlist.lastFetchedAt
  const isStale = !lastFetched || (now.getTime() - lastFetched.getTime()) > STALE_HOURS * 60 * 60 * 1000

  // Get cached videos
  let videos = await db.query.playlistVideos.findMany({
    where: eq(playlistVideos.playlistId, playlist.playlistId),
    orderBy: (pv, { asc }) => [asc(pv.position)],
  })

  // If stale, refresh in background (non-blocking)
  if (isStale) {
    // Fire and forget refresh
    fetchPlaylistVideos(playlist.playlistId).then(async (freshVideos) => {
      // Clear old cache
      await db.delete(playlistVideos).where(eq(playlistVideos.playlistId, playlist.playlistId))

      // Insert new cache
      if (freshVideos.length > 0) {
        await db.insert(playlistVideos).values(
          freshVideos.map((v, i) => ({
            playlistId: playlist.playlistId,
            videoId: v.videoId,
            position: i,
            videoTitle: v.title,
            videoThumbnail: v.thumbnail,
            duration: v.duration,
            channelTitle: v.channelTitle,
          }))
        )
      }

      // Update playlist last fetched
      await db.update(allowedPlaylists)
        .set({ lastFetchedAt: new Date(), isAvailable: true })
        .where(eq(allowedPlaylists.id, playlistDbId))
    }).catch(async () => {
      // Mark as unavailable if refresh fails
      await db.update(allowedPlaylists)
        .set({ isAvailable: false })
        .where(eq(allowedPlaylists.id, playlistDbId))
    })
  }

  return {
    playlist: {
      id: playlist.id,
      playlistId: playlist.playlistId,
      title: playlist.playlistTitle,
      thumbnail: playlist.playlistThumbnail,
      isAvailable: playlist.isAvailable,
    },
    videos,
  }
})
