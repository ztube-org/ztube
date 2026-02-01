import { parseDuration } from './youtube'

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'

function getApiKey() {
  const config = useRuntimeConfig()
  if (!config.youtubeApiKey) {
    throw createError({ statusCode: 500, message: 'YouTube API key not configured' })
  }
  return config.youtubeApiKey
}

export interface VideoMetadata {
  videoId: string
  title: string
  thumbnail: string
  duration: number
  channelTitle: string
}

export interface PlaylistMetadata {
  playlistId: string
  title: string
  thumbnail: string
}

export interface ChannelMetadata {
  channelId: string
  title: string
  thumbnail: string
}

export async function fetchVideoMetadata(videoId: string): Promise<VideoMetadata> {
  const apiKey = getApiKey()
  const url = `${YOUTUBE_API_BASE}/videos?part=snippet,contentDetails&id=${videoId}&key=${apiKey}`

  const response = await fetch(url)
  const data = await response.json()

  if (!data.items || data.items.length === 0) {
    throw createError({ statusCode: 404, message: 'Video not found' })
  }

  const item = data.items[0]
  return {
    videoId: item.id,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
    duration: parseDuration(item.contentDetails?.duration || 'PT0S'),
    channelTitle: item.snippet.channelTitle,
  }
}

export async function fetchPlaylistMetadata(playlistId: string): Promise<PlaylistMetadata> {
  const apiKey = getApiKey()
  const url = `${YOUTUBE_API_BASE}/playlists?part=snippet&id=${playlistId}&key=${apiKey}`

  const response = await fetch(url)
  const data = await response.json()

  if (!data.items || data.items.length === 0) {
    throw createError({ statusCode: 404, message: 'Playlist not found' })
  }

  const item = data.items[0]
  return {
    playlistId: item.id,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
  }
}

export async function fetchChannelMetadata(channelId: string): Promise<ChannelMetadata> {
  const apiKey = getApiKey()

  // Handle @username and c/customname formats
  let url: string
  if (channelId.startsWith('@')) {
    url = `${YOUTUBE_API_BASE}/channels?part=snippet&forHandle=${channelId}&key=${apiKey}`
  } else if (channelId.startsWith('c/')) {
    // For custom URLs, we need to search
    const customName = channelId.slice(2)
    url = `${YOUTUBE_API_BASE}/search?part=snippet&type=channel&q=${customName}&key=${apiKey}`
  } else {
    url = `${YOUTUBE_API_BASE}/channels?part=snippet&id=${channelId}&key=${apiKey}`
  }

  const response = await fetch(url)
  const data = await response.json()

  if (!data.items || data.items.length === 0) {
    throw createError({ statusCode: 404, message: 'Channel not found' })
  }

  const item = data.items[0]
  const actualChannelId = item.id.channelId || item.id

  return {
    channelId: actualChannelId,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
  }
}

export async function fetchPlaylistVideos(playlistId: string, maxResults = 50): Promise<VideoMetadata[]> {
  const apiKey = getApiKey()
  const url = `${YOUTUBE_API_BASE}/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=${maxResults}&key=${apiKey}`

  const response = await fetch(url)
  const data = await response.json()

  if (!data.items) {
    return []
  }

  // Get video IDs to fetch duration info
  const videoIds = data.items.map((item: any) => item.contentDetails.videoId).join(',')

  if (!videoIds) return []

  const videosUrl = `${YOUTUBE_API_BASE}/videos?part=contentDetails&id=${videoIds}&key=${apiKey}`
  const videosResponse = await fetch(videosUrl)
  const videosData = await videosResponse.json()

  const durationMap = new Map<string, number>()
  for (const video of videosData.items || []) {
    durationMap.set(video.id, parseDuration(video.contentDetails?.duration || 'PT0S'))
  }

  return data.items.map((item: any, index: number) => ({
    videoId: item.contentDetails.videoId,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
    duration: durationMap.get(item.contentDetails.videoId) || 0,
    channelTitle: item.snippet.channelTitle || '',
    position: index,
  }))
}

export async function fetchChannelVideos(channelId: string, maxResults = 50): Promise<VideoMetadata[]> {
  const apiKey = getApiKey()

  // First get the uploads playlist ID
  const channelUrl = `${YOUTUBE_API_BASE}/channels?part=contentDetails&id=${channelId}&key=${apiKey}`
  const channelResponse = await fetch(channelUrl)
  const channelData = await channelResponse.json()

  if (!channelData.items || channelData.items.length === 0) {
    return []
  }

  const uploadsPlaylistId = channelData.items[0].contentDetails.relatedPlaylists.uploads

  // Then fetch videos from uploads playlist
  return fetchPlaylistVideos(uploadsPlaylistId, maxResults)
}
