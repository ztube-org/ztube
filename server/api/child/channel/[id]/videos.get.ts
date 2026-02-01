import { eq, and } from 'drizzle-orm'
import { db } from '../../../../database'
import { allowedChannels, channelVideos } from '../../../../database/schema'
import { requireRole } from '../../../../utils/auth'
import { fetchChannelVideos } from '../../../../utils/youtube-api'

const STALE_HOURS = 6

export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['child'])
  const channelDbId = parseInt(getRouterParam(event, 'id') || '0')

  // Get channel and verify access
  const channel = await db.query.allowedChannels.findFirst({
    where: and(eq(allowedChannels.id, channelDbId), eq(allowedChannels.childId, user.id!)),
  })

  if (!channel) {
    throw createError({ statusCode: 404, message: 'Channel not found' })
  }

  // Check if cache is stale
  const now = new Date()
  const lastFetched = channel.lastFetchedAt
  const isStale = !lastFetched || (now.getTime() - lastFetched.getTime()) > STALE_HOURS * 60 * 60 * 1000

  // Get cached videos
  let videos = await db.query.channelVideos.findMany({
    where: eq(channelVideos.channelId, channel.channelId),
    orderBy: (cv, { asc }) => [asc(cv.position)],
  })

  // If stale, refresh in background
  if (isStale) {
    fetchChannelVideos(channel.channelId).then(async (freshVideos) => {
      await db.delete(channelVideos).where(eq(channelVideos.channelId, channel.channelId))

      if (freshVideos.length > 0) {
        await db.insert(channelVideos).values(
          freshVideos.map((v, i) => ({
            channelId: channel.channelId,
            videoId: v.videoId,
            position: i,
            videoTitle: v.title,
            videoThumbnail: v.thumbnail,
            duration: v.duration,
            channelTitle: v.channelTitle,
          }))
        )
      }

      await db.update(allowedChannels)
        .set({ lastFetchedAt: new Date(), isAvailable: true })
        .where(eq(allowedChannels.id, channelDbId))
    }).catch(async () => {
      await db.update(allowedChannels)
        .set({ isAvailable: false })
        .where(eq(allowedChannels.id, channelDbId))
    })
  }

  return {
    channel: {
      id: channel.id,
      channelId: channel.channelId,
      title: channel.channelTitle,
      thumbnail: channel.channelThumbnail,
      isAvailable: channel.isAvailable,
    },
    videos,
  }
})
