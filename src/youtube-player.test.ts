import assert from 'node:assert/strict'
import test from 'node:test'
import { authorizeAndCreatePlayer, type YouTubePlayer } from './youtube-player.ts'

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
