import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createPlaybackReporter } from './youtube-player.ts'

const flush = () => new Promise(resolve => setImmediate(resolve))

function fixture(t: TestContext, remaining = 120, heartbeat?: Parameters<typeof createPlaybackReporter>[0]['heartbeat']) {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  let visibility = () => {}
  const document = { hidden: false, pictureInPictureElement: null as Element | null,
    addEventListener(_name: string, listener: () => void) { visibility = listener }, removeEventListener() {} }
  const result = { pauses: 0, blocks: 0, remaining, document, visibility: () => visibility() }
  const reporter = createPlaybackReporter({
    initialRemainingSeconds: remaining, document,
    heartbeat: heartbeat ?? (async sequence => ({ sequence, remainingSeconds: remaining, authorized: true })),
    pause: () => { result.pauses++ }, onBlocked: () => { result.blocks++ },
    onRemaining: seconds => { result.remaining = seconds },
  })
  t.after(() => reporter.stop())
  return { result, reporter }
}

test('stops at the remaining second even with a pending heartbeat', t => {
  const { reporter, result } = fixture(t, 1, () => new Promise(() => {}))
  reporter.setState('playing')
  t.mock.timers.tick(1000)
  assert.equal(result.blocks, 1)
  assert.equal(result.remaining, 0)
})

test('failed first playing heartbeat stops immediately, rather than granting a free lease', async t => {
  const { reporter, result } = fixture(t, 120, async () => { throw new Error('offline') })
  reporter.setState('playing')
  await flush()
  assert.equal(result.blocks, 1)
})

test('a stalled heartbeat stops playback within five seconds', t => {
  const { reporter, result } = fixture(t, 120, () => new Promise(() => {}))
  reporter.setState('playing')
  t.mock.timers.tick(5000)
  assert.equal(result.blocks, 1)
})

test('local allowance excludes pauses and buffering and stale balances cannot refill it', async t => {
  const { reporter, result } = fixture(t, 3)
  reporter.setState('playing'); await flush()
  t.mock.timers.tick(1000)
  reporter.setState('buffering'); await flush()
  t.mock.timers.tick(10_000)
  reporter.setState('paused'); await flush()
  t.mock.timers.tick(10_000)
  assert.equal(result.blocks, 0)
  reporter.setState('playing'); await flush()
  t.mock.timers.tick(2000)
  assert.equal(result.blocks, 1)
  assert.equal(result.remaining, 0)
})

test('backgrounding ends playback even when picture in picture is present', async t => {
  const { reporter, result } = fixture(t)
  reporter.setState('playing'); await flush()
  result.document.pictureInPictureElement = {} as Element
  result.document.hidden = true
  result.visibility()
  assert.equal(result.blocks, 1)
  reporter.setState('playing')
  assert.equal(result.pauses, 2)
})

test('a late successful heartbeat cannot revive an expired allowance', async t => {
  let acknowledge!: (response: { sequence: number; remainingSeconds: number; authorized: boolean }) => void
  const { reporter, result } = fixture(t, 1, () => new Promise(resolve => { acknowledge = resolve }))
  reporter.setState('playing')
  t.mock.timers.tick(1000)
  acknowledge({ sequence: 1, remainingSeconds: 1, authorized: true }); await flush()
  assert.equal(result.blocks, 1)
  assert.equal(result.remaining, 0)
})

test('a server extension can increase the local balance', async t => {
  let balance = 2
  const { reporter, result } = fixture(t, 2, async sequence => ({ sequence, remainingSeconds: balance, authorized: true }))
  reporter.setState('playing'); await flush()
  t.mock.timers.tick(1000)
  balance = 10
  reporter.setState('playing'); await flush()
  t.mock.timers.tick(2000)
  assert.equal(result.blocks, 0)
  assert.equal(result.remaining, 8)
})

test('stopping at the local limit sends the final pause to settle server usage', async t => {
  const calls: Array<{ sequence: number; state: string; keepalive?: boolean }> = []
  const { reporter, result } = fixture(t, 1, async (sequence, state, _position, keepalive) => {
    calls.push({ sequence, state, keepalive })
    return { sequence, remainingSeconds: 1, authorized: true }
  })
  reporter.setState('playing'); await flush()
  t.mock.timers.tick(1000); await flush()
  assert.equal(result.blocks, 1)
  assert.deepEqual(calls, [{ sequence: 1, state: 'playing', keepalive: undefined }, { sequence: 2, state: 'paused', keepalive: true }])
})
