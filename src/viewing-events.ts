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

export interface ViewingVideoGroup {
  videoId: string
  title: string
  subtitle: string | null
  watchedSeconds: number
  timePools: string[]
  sessions: PlaybackViewingEvent[]
  unlocks: EpisodeUnlockEvent[]
}

export interface ViewingDayGroup {
  day: string
  watchedSeconds: number
  watchedVideoCount: number
  unlockCount: number
  videos: ViewingVideoGroup[]
}

const legacyTimePools = { restricted: 'Daily Allowance', exempt: 'Safety Cap', cartoon: 'Cartoon Time' }
const calendarDate = (day: string) => new Date(`${day}T00:00:00Z`)
const shortDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
const dayDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })

function dayKeyFormatter(timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  return (date: Date) => {
    const parts = formatter.formatToParts(date)
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value
    return `${part('year')}-${part('month')}-${part('day')}`
  }
}

export function shortViewingDate(day: string) {
  return shortDate.format(calendarDate(day))
}

export function viewingDayLabel(day: string, timeZone: string, now = new Date()) {
  const today = dayKeyFormatter(timeZone)(now)
  const yesterday = new Date(calendarDate(today).getTime() - 86_400_000).toISOString().slice(0, 10)
  const label = dayDate.format(calendarDate(day))
  if (day === today) return `Today · ${label}`
  if (day === yesterday) return `Yesterday · ${label}`
  return label
}

export function watchDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (!minutes) return `${remainder}s`
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`
}

export function groupViewingEvents(events: readonly ViewingEvent[], timeZone: string): ViewingDayGroup[] {
  const dayKey = dayKeyFormatter(timeZone)
  const occurredAt = (event: ViewingEvent) => event.kind === 'playback' ? event.startedAt : event.unlockedAt
  const byDay = new Map<string, Map<string, ViewingVideoGroup>>()
  for (const event of [...events].sort((a, b) => occurredAt(b) - occurredAt(a))) {
    const day = dayKey(new Date(occurredAt(event) * 1000))
    const videos = byDay.get(day) ?? new Map<string, ViewingVideoGroup>()
    byDay.set(day, videos)
    const video = videos.get(event.videoId) ?? {
      videoId: event.videoId, title: 'Unavailable video', subtitle: null, watchedSeconds: 0, timePools: [], sessions: [], unlocks: [],
    }
    videos.set(event.videoId, video)
    if (video.title === 'Unavailable video' && event.videoTitle && event.videoTitle !== event.videoId) video.title = event.videoTitle
    video.subtitle ??= event.channelTitle
    if (event.kind === 'unlock') {
      video.unlocks.push(event)
    } else {
      video.sessions.push(event)
      video.watchedSeconds += event.watchedSeconds
      const pool = event.timePoolName ?? legacyTimePools[event.usageBucket]
      if (!video.timePools.includes(pool)) video.timePools.push(pool)
    }
  }

  return Array.from(byDay, ([day, groups]) => {
    const videos = [...groups.values()]
    return {
      day,
      videos,
      watchedSeconds: videos.reduce((total, video) => total + video.watchedSeconds, 0),
      watchedVideoCount: videos.filter(video => video.sessions.length).length,
      unlockCount: videos.reduce((total, video) => total + video.unlocks.length, 0),
    }
  })
}
