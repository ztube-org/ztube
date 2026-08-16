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
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(instant)
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
