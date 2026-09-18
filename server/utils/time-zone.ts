// Formatters are immutable, reusable, and bounded independently of request data.
export function timeZoneFormatters(options: Intl.DateTimeFormatOptions) {
  const cache = new Map<string, Intl.DateTimeFormat>()
  return (timeZone: string) => {
    let formatter = cache.get(timeZone)
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone })
      if (cache.size >= 64) cache.delete(cache.keys().next().value!)
      cache.set(timeZone, formatter)
    }
    return formatter
  }
}
