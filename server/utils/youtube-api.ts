import { parseDuration } from './youtube.ts'

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'

function requireApiKey(apiKey: string) {
  if (!apiKey) {
    throw new Error('YouTube API key not configured')
  }
  return apiKey
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
  uploadsPlaylistId: string
  title: string
  thumbnail: string
}

export async function fetchVideoMetadata(videoId: string, key: string): Promise<VideoMetadata> {
  const apiKey = requireApiKey(key)
  const url = `${YOUTUBE_API_BASE}/videos?part=snippet,contentDetails&id=${videoId}&key=${apiKey}`

  const response = await fetch(url)
  const data = await response.json() as { items?: any[] }

  if (!data.items || data.items.length === 0) {
    throw new Error('Video not found')
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

export async function fetchPlaylistMetadata(playlistId: string, key: string): Promise<PlaylistMetadata> {
  const apiKey = requireApiKey(key)
  const url = `${YOUTUBE_API_BASE}/playlists?part=snippet&id=${playlistId}&key=${apiKey}`

  const response = await fetch(url)
  const data = await response.json() as { items?: any[] }

  if (!data.items || data.items.length === 0) {
    throw new Error('Playlist not found')
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

  const response = await fetch(url)
  const data = await response.json() as { items?: any[] }

  if (!data.items || data.items.length === 0) {
    throw new Error('Channel not found')
  }

  const item = data.items[0]
  const actualChannelId = item.id.channelId || item.id

  return {
    channelId: actualChannelId,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
  }
}

export async function fetchPlaylistVideos(playlistId: string, key: string, maxResults = 50): Promise<VideoMetadata[]> {
  const apiKey = requireApiKey(key)
  const url = `${YOUTUBE_API_BASE}/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=${maxResults}&key=${apiKey}`

  const response = await fetch(url)
  const data = await response.json() as { items?: any[] }

  if (!data.items) {
    return []
  }

  // Get video IDs to fetch duration info
  const videoIds = data.items.map((item: any) => item.contentDetails.videoId).join(',')

  if (!videoIds) return []

  const videosUrl = `${YOUTUBE_API_BASE}/videos?part=contentDetails&id=${videoIds}&key=${apiKey}`
  const videosResponse = await fetch(videosUrl)
  const videosData = await videosResponse.json() as { items?: any[] }

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

export async function fetchChannelVideos(channelId: string, key: string, maxResults = 50): Promise<VideoMetadata[]> {
  const apiKey = requireApiKey(key)

  // First get the uploads playlist ID
  const channelUrl = `${YOUTUBE_API_BASE}/channels?part=contentDetails&id=${channelId}&key=${apiKey}`
  const channelResponse = await fetch(channelUrl)
  const channelData = await channelResponse.json() as { items?: any[] }

  if (!channelData.items || channelData.items.length === 0) {
    return []
  }

  const uploadsPlaylistId = channelData.items[0].contentDetails.relatedPlaylists.uploads

  // Then fetch videos from uploads playlist
  return fetchPlaylistVideos(uploadsPlaylistId, apiKey, maxResults)
}
