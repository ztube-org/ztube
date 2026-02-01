import { eq, and } from 'drizzle-orm'
import { db } from '../../../database'
import { children, allowedChannels, allowedPlaylists, allowedVideos } from '../../../database/schema'
import { requireRole } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['parent'])
  const contentId = parseInt(getRouterParam(event, 'id') || '0')
  const query = getQuery(event)
  const type = query.type as string

  if (!['channel', 'playlist', 'video'].includes(type)) {
    throw createError({ statusCode: 400, message: 'Invalid content type' })
  }

  // Get the content and verify ownership through child
  let content: any
  let table: any

  switch (type) {
    case 'channel':
      table = allowedChannels
      content = await db.query.allowedChannels.findFirst({ where: eq(allowedChannels.id, contentId) })
      break
    case 'playlist':
      table = allowedPlaylists
      content = await db.query.allowedPlaylists.findFirst({ where: eq(allowedPlaylists.id, contentId) })
      break
    case 'video':
      table = allowedVideos
      content = await db.query.allowedVideos.findFirst({ where: eq(allowedVideos.id, contentId) })
      break
  }

  if (!content) {
    throw createError({ statusCode: 404, message: 'Content not found' })
  }

  // Verify child belongs to parent
  const child = await db.query.children.findFirst({
    where: and(eq(children.id, content.childId), eq(children.parentId, user.id!)),
  })

  if (!child) {
    throw createError({ statusCode: 403, message: 'Not authorized to delete this content' })
  }

  await db.delete(table).where(eq(table.id, contentId))

  return { success: true }
})
