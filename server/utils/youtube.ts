export type YouTubeContentType = 'video' | 'playlist' | 'channel'

export interface ParsedYouTubeUrl {
  type: YouTubeContentType
  id: string
}

export function parseYouTubeUrl(url: string): ParsedYouTubeUrl | null {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.replace('www.', '')

    // Video URLs
    if (hostname === 'youtube.com' || hostname === 'youtu.be') {
      // youtu.be/VIDEO_ID
      if (hostname === 'youtu.be') {
        const videoId = urlObj.pathname.slice(1)
        if (videoId) return { type: 'video', id: videoId }
      }

      // youtube.com/watch?v=VIDEO_ID
      const videoId = urlObj.searchParams.get('v')
      if (videoId) return { type: 'video', id: videoId }

      // youtube.com/shorts/VIDEO_ID (parsed so the server can reject it explicitly)
      const shortMatch = urlObj.pathname.match(/^\/shorts\/([^/]+)/)
      if (shortMatch) return { type: 'video', id: shortMatch[1] }

      // youtube.com/playlist?list=PLAYLIST_ID
      const playlistId = urlObj.searchParams.get('list')
      if (playlistId && !videoId) return { type: 'playlist', id: playlistId }

      // youtube.com/channel/CHANNEL_ID
      const channelMatch = urlObj.pathname.match(/^\/channel\/([^/]+)/)
      if (channelMatch) return { type: 'channel', id: channelMatch[1] }

      // youtube.com/@USERNAME
      const handleMatch = urlObj.pathname.match(/^\/@([^/]+)/)
      if (handleMatch) return { type: 'channel', id: `@${handleMatch[1]}` }

      // youtube.com/c/CUSTOMNAME
      const customMatch = urlObj.pathname.match(/^\/c\/([^/]+)/)
      if (customMatch) return { type: 'channel', id: `c/${customMatch[1]}` }
    }

    return null
  } catch {
    return null
  }
}

// Parse ISO 8601 duration to seconds
export function parseDuration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  const hours = parseInt(match[1] || '0', 10)
  const minutes = parseInt(match[2] || '0', 10)
  const seconds = parseInt(match[3] || '0', 10)
  return hours * 3600 + minutes * 60 + seconds
}

// Format seconds to display string
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}
