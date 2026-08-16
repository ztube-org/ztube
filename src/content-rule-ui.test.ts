import assert from 'node:assert/strict'
import test from 'node:test'
import { contentStatus } from './content-rule-ui.ts'

const watchTime = {
  restricted: { remainingSeconds: 0, locked: true },
  exempt: { remainingSeconds: 870, locked: false },
}

test('child UI treats Content Rule buckets independently', () => {
  assert.deepEqual(contentStatus('restricted', watchTime), {
    remainingSeconds: 0, locked: true, label: null, exhaustedLabel: 'Daily Allowance used',
  })
  assert.deepEqual(contentStatus('exempt', watchTime), {
    remainingSeconds: 870,
    locked: false,
    label: '不计入普通额度 · 14 分钟安全时长剩余',
    exhaustedLabel: 'Safety Cap used',
  })
})
