export type ContentRule = 'restricted' | 'exempt'

type BucketStatus = { remainingSeconds: number; locked: boolean }
type WatchTimeStatus = { restricted: BucketStatus; exempt: BucketStatus }

export function contentStatus(rule: ContentRule, watchTime: WatchTimeStatus) {
  const bucket = rule === 'exempt' ? watchTime.exempt : watchTime.restricted
  return {
    ...bucket,
    label: rule === 'exempt'
      ? `不计入普通额度 · ${Math.floor(bucket.remainingSeconds / 60)} 分钟安全时长剩余`
      : null,
    exhaustedLabel: rule === 'exempt' ? 'Safety Cap used' : 'Daily Allowance used',
  }
}
