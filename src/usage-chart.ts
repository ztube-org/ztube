export function usageChartScale(seconds: number[]) {
  const maximum = Math.max(1, ...seconds.map(value => Math.max(0, value) / 60))
  const roughStep = maximum / 4
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const step = Math.max(1, ([1, 2, 2.5, 5, 10].find(value => value * magnitude >= roughStep) ?? 10) * magnitude)
  const ceiling = Math.ceil(maximum / step) * step
  const ticks = Array.from({ length: Math.round(ceiling / step) + 1 }, (_, index) => index * step)
  return { ceiling, ticks }
}
