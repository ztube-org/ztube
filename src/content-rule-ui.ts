import type { ContentRule, WatchTimeStatus } from './domain'

export type { ContentRule } from './domain'

// A source can contain a more-specific video override that uses the other bucket.
export function sourceIsNavigable() {
  return true
}

export function contentStatus(rule: ContentRule, watchTime: WatchTimeStatus) {
  const bucket = rule === 'exempt' ? watchTime.exempt : watchTime.restricted
  return {
    ...bucket,
    label: rule === 'exempt'
      ? `Safety Cap only · ${Math.floor(bucket.remainingSeconds / 60)} min remaining`
      : null,
    exhaustedLabel: rule === 'exempt' ? 'Safety Cap used' : 'Daily Allowance used',
  }
}
