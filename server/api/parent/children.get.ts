import { eq, count } from 'drizzle-orm'
import { db } from '~/server/database'
import { children, allowedChannels, allowedPlaylists, allowedVideos } from '~/server/database/schema'
import { requireRole } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['parent'])

  const childList = await db.query.children.findMany({
    where: eq(children.parentId, user.id!),
  })

  // Get content counts for each child
  const childrenWithStats = await Promise.all(
    childList.map(async (child) => {
      const [channelCount] = await db.select({ count: count() }).from(allowedChannels).where(eq(allowedChannels.childId, child.id))
      const [playlistCount] = await db.select({ count: count() }).from(allowedPlaylists).where(eq(allowedPlaylists.childId, child.id))
      const [videoCount] = await db.select({ count: count() }).from(allowedVideos).where(eq(allowedVideos.childId, child.id))

      return {
        id: child.id,
        username: child.username,
        displayName: child.displayName,
        createdAt: child.createdAt,
        stats: {
          channels: channelCount.count,
          playlists: playlistCount.count,
          videos: videoCount.count,
        },
      }
    })
  )

  return { children: childrenWithStats }
})
