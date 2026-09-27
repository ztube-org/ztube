export interface PlaybackViewingEvent {
  kind: 'playback'
  sessionId: string
  videoId: string
  videoTitle: string
  channelTitle: string | null
  usageBucket: 'restricted' | 'exempt' | 'cartoon'
  timePoolId: string | null
  timePoolName: string | null
  startedAt: number
  lastWatchedAt: number
  watchedSeconds: number
  status: 'playing' | 'paused' | 'buffering' | 'ended'
}

export interface EpisodeUnlockEvent {
  kind: 'unlock'
  videoId: string
  videoTitle: string
  channelTitle: string | null
  unlockedAt: number
}

export type ViewingEvent = PlaybackViewingEvent | EpisodeUnlockEvent

export interface ViewingEventsResponse {
  events: ViewingEvent[]
  nextCursor: string | null
  timeZone: string
  retentionDays: number
}
