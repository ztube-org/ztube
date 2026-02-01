import { eq } from 'drizzle-orm'
import { db } from '~/server/database'
import { allowedChannels, allowedPlaylists, allowedVideos } from '~/server/database/schema'
import { requireRole } from '~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['child'])

  const [channels, playlists, videos] = await Promise.all([
    db.query.allowedChannels.findMany({ where: eq(allowedChannels.childId, user.id!) }),
    db.query.allowedPlaylists.findMany({ where: eq(allowedPlaylists.childId, user.id!) }),
    db.query.allowedVideos.findMany({ where: eq(allowedVideos.childId, user.id!) }),
  ])

  return { channels, playlists, videos }
})
