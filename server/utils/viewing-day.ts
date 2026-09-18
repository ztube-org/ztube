import { timeZoneFormatters } from './time-zone.ts'

const dateFormatter = timeZoneFormatters({ year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })

export type RecurringAllowances = {
  weekdayAllowanceMinutes: number
  weekendAllowanceMinutes: number
}

export type ViewingDay = {
  localDate: string
  dayOfWeek: number
  isWeekend: boolean
  allowanceMinutes: number
}

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format()
    return true
  } catch {
    return false
  }
}

export function viewingDayAt(instant: Date, timeZone: string, settings: RecurringAllowances): ViewingDay {
  const parts = dateFormatter(timeZone).formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value ?? ''
  const weekday = part('weekday')
  const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
  return {
    localDate: `${part('year')}-${part('month')}-${part('day')}`,
    dayOfWeek,
    isWeekend,
    allowanceMinutes: isWeekend ? settings.weekendAllowanceMinutes : settings.weekdayAllowanceMinutes,
  }
}

export function epochSeconds(value: Date) {
  return Math.floor(value.getTime() / 1000)
}

export function viewingDaySegments(start: Date, end: Date, timeZone: string, settings: RecurringAllowances) {
  let startEpoch = epochSeconds(start)
  const endEpoch = epochSeconds(end)
  const segments: Array<{ viewingDay: string; startEpoch: number; endEpoch: number }> = []
  const dateAt = (epoch: number) => viewingDayAt(new Date(epoch * 1000), timeZone, settings).localDate
  while (startEpoch < endEpoch) {
    const day = dateAt(startEpoch)
    let boundary = endEpoch
    if (dateAt(endEpoch - 1) !== day) {
      let low = startEpoch + 1
      let high = endEpoch - 1
      while (low < high) {
        const mid = Math.floor((low + high) / 2)
        if (dateAt(mid) === day) low = mid + 1
        else high = mid
      }
      boundary = low
    }
    segments.push({ viewingDay: day, startEpoch, endEpoch: boundary })
    startEpoch = boundary
  }
  return segments
}
