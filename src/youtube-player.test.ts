import assert from 'node:assert/strict'
import test from 'node:test'
import { authorizeAndCreatePlayer, createPlaybackReporter, type YouTubePlayer, youtubeState } from './youtube-player.ts'

test('constructs the thin player adapter only after Playback Authorization succeeds', async () => {
  const calls: string[] = []
  const player: YouTubePlayer = { setPlaybackRate() {} }
  const result = await authorizeAndCreatePlayer(
    'approved',
    async videoId => { calls.push(`authorize:${videoId}`) },
    async () => { calls.push('construct'); return player },
  )
  assert.equal(result, player)
  assert.deepEqual(calls, ['authorize:approved', 'construct'])
})

test('never constructs a player when Playback Authorization is rejected', async () => {
  let constructed = false
  await assert.rejects(() => authorizeAndCreatePlayer(
    'arbitrary',
    async () => { throw new Error('Video is not Approved Content') },
    async () => { constructed = true; return { setPlaybackRate() {} } },
  ), /not Approved Content/)
  assert.equal(constructed, false)
})

test('maps YouTube playing, buffering, ended, and paused states without using speed or position', () => {
  assert.equal(youtubeState(1), 'playing')
  assert.equal(youtubeState(3), 'buffering')
  assert.equal(youtubeState(0), 'ended')
  assert.equal(youtubeState(2), 'paused')
})

test('pauses hidden playback and stops when the server ends authorization', async () => {
  let visibility: (() => void) | undefined
  let paused = 0
  const states: string[] = []
  const document = {
    hidden: false,
    pictureInPictureElement: null,
    addEventListener(_name: string, listener: () => void) { visibility = listener },
    removeEventListener() {},
  }
  const reporter = createPlaybackReporter({
    initialRemainingSeconds: 2,
    document: document as any,
    intervalMs: 60_000,
    pause: () => { paused++ },
    onRemaining() {},
    heartbeat: async (_sequence, state) => { states.push(state); return { remainingSeconds: 0, authorized: false } },
  })
  document.hidden = true
  visibility?.()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(states, ['paused'])
  assert.equal(paused, 2)
  reporter.stop()
})

test('pauses when heartbeats cannot renew the 60-second lease', async () => {
  let paused = 0
  let time = 0
  const document = {
    hidden: false,
    pictureInPictureElement: null,
    addEventListener() {},
    removeEventListener() {},
  }
  const reporter = createPlaybackReporter({
    initialRemainingSeconds: 120,
    document: document as any,
    intervalMs: 60_000,
    leaseMs: 60_000,
    now: () => time,
    pause: () => { paused++ },
    onRemaining() {},
    heartbeat: async () => { throw new Error('offline') },
  })
  reporter.setState('playing')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(paused, 0)
  time = 60_000
  reporter.setState('playing')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(paused, 1)
  reporter.stop()
})
