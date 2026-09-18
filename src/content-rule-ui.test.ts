import assert from 'node:assert/strict'
import test from 'node:test'
import { contentStatus, sourceIsNavigable } from './content-rule-ui.ts'
import { videoUnavailable } from './video-ui.ts'

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
    label: 'Safety Cap only · 14 min remaining',
    exhaustedLabel: 'Safety Cap used',
  })
})

test('a source remains navigable when its own bucket is exhausted because a video override may use the other bucket', () => {
  assert.equal(sourceIsNavigable(), true)
})

test('Cartoon Pool cards use their separate balance even through an exempt content rule', () => {
  const video = { videoId: 'ep', videoTitle: 'Episode', duration: 600, videoThumbnail: null, channelTitle: null, publishedAt: null, contentRule: 'exempt' as const, usageBucket: 'cartoon' as const }
  const viewing = { watchTime: { restricted: { locked: true, remainingSeconds: 0 }, exempt: { locked: true, remainingSeconds: 0 }, cartoon: { locked: false, remainingSeconds: 1800 } }, policy: { blocked: false } }
  assert.equal(videoUnavailable(video, viewing), '')
  viewing.watchTime.cartoon = { locked: true, remainingSeconds: 0 }
  assert.equal(videoUnavailable(video, viewing), 'Cartoon Time used')
})
