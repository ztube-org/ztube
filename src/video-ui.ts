import type { ApprovedVideo, ViewingStatus } from './domain'

export function formatDuration(seconds: number | null) {
  if (!seconds) return ''
  const whole = Math.floor(seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor(whole / 60) % 60
  const secondsLabel = String(whole % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secondsLabel}` : `${minutes}:${secondsLabel}`
}

export function formatPublishedDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(value)) : ''
}

export function videoUnavailable(video: ApprovedVideo, status: ViewingStatus | null) {
  if (video.timePoolConflict) return 'Ask an Admin to choose this video’s time pool'
  if (video.isAvailable === false) return 'This video is unavailable'
  if (status?.policy.blocked) return 'Playback is unavailable right now'
  const pool = status?.watchTime.pools?.find(pool => pool.id === video.timePoolId)
  if (pool) return pool.locked ? `${pool.name} time used` : ''
  const usageBucket = video.usageBucket ?? video.contentRule
  const bucket = status?.watchTime[usageBucket]
  return bucket?.locked ? (usageBucket === 'cartoon' ? 'Cartoon Time used' : usageBucket === 'exempt' ? 'Safety Cap used' : 'Daily Allowance used') : ''
}
