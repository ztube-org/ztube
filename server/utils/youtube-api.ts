import * as v from 'valibot'
import { parseDuration } from './youtube.ts'

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'

export class YouTubeApiError extends Error {}

const thumbnailSchema = v.object({ url: v.string() })
const thumbnailsSchema = v.object({
  medium: v.optional(thumbnailSchema),
  default: v.optional(thumbnailSchema),
})
const apiErrorSchema = v.object({
  error: v.optional(v.object({
    message: v.optional(v.string()),
    errors: v.optional(v.array(v.object({ reason: v.optional(v.string()) }))),
  })),
})
const videoItemSchema = v.object({
  id: v.string(),
  snippet: v.object({
    title: v.optional(v.string(), ''),
    description: v.optional(v.string()),
    thumbnails: v.optional(thumbnailsSchema, {}),
    channelTitle: v.optional(v.string(), ''),
    publishedAt: v.optional(v.string()),
  }),
  contentDetails: v.optional(v.object({ duration: v.optional(v.string()) })),
  status: v.optional(v.object({ embeddable: v.optional(v.boolean(), true) })),
})
const videoListSchema = v.object({ items: v.optional(v.array(videoItemSchema), []) })
const playlistListSchema = v.object({ items: v.optional(v.array(v.object({
  id: v.string(),
  snippet: v.object({ title: v.string(), thumbnails: v.optional(thumbnailsSchema, {}) }),
})), []) })
const channelListSchema = v.object({ items: v.optional(v.array(v.object({
  id: v.union([v.string(), v.object({ channelId: v.string() })]),
  snippet: v.optional(v.object({ title: v.string(), thumbnails: v.optional(thumbnailsSchema, {}) })),
  contentDetails: v.object({ relatedPlaylists: v.object({ uploads: v.string() }) }),
})), []) })
const playlistItemsSchema = v.object({
  items: v.optional(v.array(v.object({
    contentDetails: v.object({ videoId: v.string() }),
    snippet: v.object({
      title: v.string(),
      thumbnails: v.optional(thumbnailsSchema, {}),
      channelTitle: v.optional(v.string(), ''),
    }),
  })), []),
  nextPageToken: v.optional(v.string()),
})

async function youtubeJson<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(url: string, schema: TSchema): Promise<v.InferOutput<TSchema>> {
  const response = await fetch(url)
  const raw: unknown = await response.json()
  if (!response.ok) {
    const parsedError = v.safeParse(apiErrorSchema, raw)
    const data = parsedError.success ? parsedError.output : {}
    const reason = data.error?.errors?.[0]?.reason
    const message = reason === 'quotaExceeded'
      ? 'YouTube API quota is exhausted'
      : data.error?.message?.includes('API key not valid')
        ? 'YouTube API key is invalid; update YOUTUBE_API_KEY'
        : `YouTube API request failed${data.error?.message ? `: ${data.error.message}` : ''}`
    throw new YouTubeApiError(message)
  }
  const parsed = v.safeParse(schema, raw)
  if (!parsed.success) throw new YouTubeApiError('YouTube API returned an invalid response')
  return parsed.output
}

function requireApiKey(apiKey: string) {
  if (!apiKey) {
    throw new YouTubeApiError('YouTube API key is not configured')
  }
  return apiKey
}

export interface VideoMetadata {
  videoId: string
  title: string
  description: string
  thumbnail: string
  duration: number
  channelTitle: string
  publishedAt: Date | null
  embeddable: boolean
}

export interface PlaylistMetadata {
  playlistId: string
  title: string
  thumbnail: string
}

export interface ChannelMetadata {
  channelId: string
  uploadsPlaylistId: string
  title: string
  thumbnail: string
}

export async function fetchVideoMetadata(videoId: string, key: string): Promise<VideoMetadata> {
  const apiKey = requireApiKey(key)
  const url = `${YOUTUBE_API_BASE}/videos?part=snippet,contentDetails,status&id=${videoId}&key=${apiKey}`

  const data = await youtubeJson(url, videoListSchema)

  if (!data.items || data.items.length === 0) {
    throw new YouTubeApiError('Video not found')
  }

  const item = data.items[0]
  return {
    videoId: item.id,
    title: item.snippet.title,
    description: item.snippet.description || '',
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
    duration: parseDuration(item.contentDetails?.duration || 'PT0S'),
    channelTitle: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt ? new Date(item.snippet.publishedAt) : null,
    embeddable: item.status?.embeddable !== false,
  }
}

export async function fetchPlaylistMetadata(playlistId: string, key: string): Promise<PlaylistMetadata> {
  const apiKey = requireApiKey(key)
  const url = `${YOUTUBE_API_BASE}/playlists?part=snippet&id=${playlistId}&key=${apiKey}`

  const data = await youtubeJson(url, playlistListSchema)

  if (!data.items || data.items.length === 0) {
    throw new YouTubeApiError('Playlist not found')
  }

  const item = data.items[0]
  return {
    playlistId: item.id,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
  }
}

export async function fetchChannelMetadata(channelId: string, key: string): Promise<ChannelMetadata> {
  const apiKey = requireApiKey(key)

  // Handle modern @handles and stable channel IDs without the 100-unit search endpoint.
  let url: string
  if (channelId.startsWith('@')) {
    url = `${YOUTUBE_API_BASE}/channels?part=snippet,contentDetails&forHandle=${channelId}&key=${apiKey}`
  } else if (channelId.startsWith('c/')) {
    throw new Error('Legacy custom channel URLs are not supported; use an @handle or /channel/ URL')
  } else {
    url = `${YOUTUBE_API_BASE}/channels?part=snippet,contentDetails&id=${channelId}&key=${apiKey}`
  }

  const data = await youtubeJson(url, channelListSchema)

  if (!data.items || data.items.length === 0) {
    throw new YouTubeApiError('Channel not found')
  }

  const item = data.items[0]
  const actualChannelId = typeof item.id === 'string' ? item.id : item.id.channelId
  if (!item.snippet) throw new YouTubeApiError('Channel metadata is incomplete')

  return {
    channelId: actualChannelId,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
  }
}

export async function fetchPlaylistVideosPage(playlistId: string, key: string, pageToken?: string, maxResults = 50): Promise<{ videos: VideoMetadata[]; nextPageToken: string | null }> {
  const apiKey = requireApiKey(key)
  const url = new URL(`${YOUTUBE_API_BASE}/playlistItems`)
  url.search = new URLSearchParams({ part: 'snippet,contentDetails', playlistId, maxResults: String(maxResults), key: apiKey, ...(pageToken ? { pageToken } : {}) }).toString()

  const data = await youtubeJson(url.toString(), playlistItemsSchema)

  if (!data.items) {
    return { videos: [], nextPageToken: null }
  }

  // Get video IDs to fetch duration info
  const videoIds = data.items.map(item => item.contentDetails.videoId).join(',')

  if (!videoIds) return { videos: [], nextPageToken: data.nextPageToken ?? null }

  const videosUrl = `${YOUTUBE_API_BASE}/videos?part=snippet,contentDetails,status&id=${videoIds}&key=${apiKey}`
  const videosData = await youtubeJson(videosUrl, videoListSchema)

  const metadataMap = new Map<string, { description: string; duration: number; publishedAt: Date | null; embeddable: boolean }>()
  for (const video of videosData.items || []) {
    metadataMap.set(video.id, {
      description: video.snippet?.description || '',
      duration: parseDuration(video.contentDetails?.duration || 'PT0S'),
      publishedAt: video.snippet?.publishedAt ? new Date(video.snippet.publishedAt) : null,
      embeddable: video.status?.embeddable !== false,
    })
  }

  return {
    videos: data.items.map((item, index) => ({
      videoId: item.contentDetails.videoId,
      title: item.snippet.title,
      description: metadataMap.get(item.contentDetails.videoId)?.description || '',
      thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
      duration: metadataMap.get(item.contentDetails.videoId)?.duration || 0,
      channelTitle: item.snippet.channelTitle || '',
      publishedAt: metadataMap.get(item.contentDetails.videoId)?.publishedAt ?? null,
      embeddable: metadataMap.get(item.contentDetails.videoId)?.embeddable ?? false,
      position: index,
    })),
    nextPageToken: data.nextPageToken ?? null,
  }
}

export async function fetchPlaylistVideos(playlistId: string, key: string, maxResults = 50): Promise<VideoMetadata[]> {
  return (await fetchPlaylistVideosPage(playlistId, key, undefined, maxResults)).videos
}

export async function fetchChannelVideos(channelId: string, key: string, maxResults = 50): Promise<VideoMetadata[]> {
  const apiKey = requireApiKey(key)

  // First get the uploads playlist ID
  const channelUrl = `${YOUTUBE_API_BASE}/channels?part=contentDetails&id=${channelId}&key=${apiKey}`
  const channelData = await youtubeJson(channelUrl, channelListSchema)

  if (!channelData.items || channelData.items.length === 0) {
    return []
  }

  const uploadsPlaylistId = channelData.items[0].contentDetails.relatedPlaylists.uploads

  // Then fetch videos from uploads playlist
  return fetchPlaylistVideos(uploadsPlaylistId, apiKey, maxResults)
}
