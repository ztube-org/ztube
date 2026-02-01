import { eq, and } from 'drizzle-orm'
import { db } from '../../../../database'
import { children, allowedChannels, allowedPlaylists, allowedVideos } from '../../../../database/schema'
import { requireRole } from '../../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['parent'])
  const childId = parseInt(getRouterParam(event, 'id') || '0')

  // Verify child belongs to parent
  const child = await db.query.children.findFirst({
    where: and(eq(children.id, childId), eq(children.parentId, user.id!)),
  })

  if (!child) {
    throw createError({ statusCode: 404, message: 'Child not found' })
  }

  const [channels, playlists, videos] = await Promise.all([
    db.query.allowedChannels.findMany({ where: eq(allowedChannels.childId, childId) }),
    db.query.allowedPlaylists.findMany({ where: eq(allowedPlaylists.childId, childId) }),
    db.query.allowedVideos.findMany({ where: eq(allowedVideos.childId, childId) }),
  ])

  return {
    child: {
      id: child.id,
      username: child.username,
      displayName: child.displayName,
    },
    channels,
    playlists,
    videos,
  }
})
