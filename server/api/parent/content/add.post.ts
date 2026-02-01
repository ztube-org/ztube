import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../../../database'
import { children, allowedChannels, allowedPlaylists, allowedVideos } from '../../../database/schema'
import { requireRole } from '../../../utils/auth'
import { parseYouTubeUrl } from '../../../utils/youtube'
import { fetchVideoMetadata, fetchPlaylistMetadata, fetchChannelMetadata } from '../../../utils/youtube-api'

const addContentSchema = z.object({
  childId: z.number(),
  url: z.string().url(),
})

export default defineEventHandler(async (event) => {
  const user = requireRole(event, ['parent'])
  const body = await readBody(event)
  const { childId, url } = addContentSchema.parse(body)

  // Verify child belongs to parent
  const child = await db.query.children.findFirst({
    where: and(eq(children.id, childId), eq(children.parentId, user.id!)),
  })

  if (!child) {
    throw createError({ statusCode: 404, message: 'Child not found' })
  }

  // Parse URL
  const parsed = parseYouTubeUrl(url)
  if (!parsed) {
    throw createError({ statusCode: 400, message: 'Invalid YouTube URL' })
  }

  const now = new Date()

  switch (parsed.type) {
    case 'video': {
      const metadata = await fetchVideoMetadata(parsed.id)
      const [result] = await db.insert(allowedVideos).values({
        childId,
        videoId: metadata.videoId,
        videoTitle: metadata.title,
        videoThumbnail: metadata.thumbnail,
        duration: metadata.duration,
        channelTitle: metadata.channelTitle,
        lastFetchedAt: now,
        isAvailable: true,
      }).returning()
      return { type: 'video', content: result }
    }

    case 'playlist': {
      const metadata = await fetchPlaylistMetadata(parsed.id)
      const [result] = await db.insert(allowedPlaylists).values({
        childId,
        playlistId: metadata.playlistId,
        playlistTitle: metadata.title,
        playlistThumbnail: metadata.thumbnail,
        lastFetchedAt: now,
        isAvailable: true,
      }).returning()
      return { type: 'playlist', content: result }
    }

    case 'channel': {
      const metadata = await fetchChannelMetadata(parsed.id)
      const [result] = await db.insert(allowedChannels).values({
        childId,
        channelId: metadata.channelId,
        channelTitle: metadata.title,
        channelThumbnail: metadata.thumbnail,
        lastFetchedAt: now,
        isAvailable: true,
      }).returning()
      return { type: 'channel', content: result }
    }
  }
})
