export interface ViewingEvent {
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

export interface ViewingEventsResponse {
  events: ViewingEvent[]
  nextCursor: string | null
  timeZone: string
  retentionDays: number
}
