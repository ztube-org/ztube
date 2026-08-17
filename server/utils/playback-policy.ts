export type PlaybackPolicySettings = {
  timeZone: string
  allowedStartMinute: number
  allowedEndMinute: number
  breakAfterMinutes: number
  breakDurationMinutes: number
}

export type PlaybackPolicyUsage = {
  playbackPaused?: boolean
  breakCycleSeconds?: number
  breakUntil?: Date | null
}

export type PlaybackPolicyReason = 'viewing-pause' | 'outside-window' | 'required-break'

export function localMinuteAt(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(value => value.type === type)?.value ?? 0)
  return part('hour') * 60 + part('minute')
}

export function playbackPolicyAt(instant: Date, settings: PlaybackPolicySettings, usage: PlaybackPolicyUsage) {
  const breakLimitSeconds = settings.breakAfterMinutes * 60
  const breakCycleSeconds = usage.breakCycleSeconds ?? 0
  let reason: PlaybackPolicyReason | null = null

  if (usage.playbackPaused) reason = 'viewing-pause'
  else if (usage.breakUntil && usage.breakUntil.getTime() > instant.getTime()) reason = 'required-break'
  else {
    const minute = localMinuteAt(instant, settings.timeZone)
    if (minute < settings.allowedStartMinute || minute >= settings.allowedEndMinute) reason = 'outside-window'
  }

  return {
    reason,
    blocked: reason !== null,
    breakCycleRemainingSeconds: breakLimitSeconds === 0 ? null : Math.max(0, breakLimitSeconds - breakCycleSeconds),
    breakUntil: usage.breakUntil?.toISOString() ?? null,
  }
}

export function playbackPolicyMessage(reason: PlaybackPolicyReason) {
  if (reason === 'viewing-pause') return 'Viewing is paused by the Admin for today'
  if (reason === 'required-break') return 'A Required Break is in progress'
  return 'Playback is outside the Child’s Viewing Window'
}
