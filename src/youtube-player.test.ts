import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { authorizeAndCreatePlayer, createPlaybackReporter, createYouTubePlayer, type YouTubePlayer, youtubeState } from './youtube-player.ts'

function installNoCookiePlayerWindow() {
  const priorWindow = globalThis.window
  const posts: Array<{ message: any; targetOrigin: string }> = []
  let load: (() => void) | undefined
  let receive: ((event: any) => void) | undefined
  let removed = false
  const contentWindow = {
    postMessage(raw: string, targetOrigin: string) {
      posts.push({ message: JSON.parse(raw), targetOrigin })
    },
  }
  const iframe = {
    src: '',
    title: '',
    allow: '',
    allowFullscreen: false,
    style: {} as Record<string, string>,
    contentWindow,
    addEventListener(name: string, listener: () => void) { if (name === 'load') load = listener },
    remove() { removed = true },
  }
  const container = {
    replaceChildren(child: unknown) { assert.equal(child, iframe) },
  }
  globalThis.window = {
    location: { origin: 'https://ztube.example' },
    document: {
      getElementById(id: string) { return id === 'youtube-player' ? container : null },
      createElement(name: string) { assert.equal(name, 'iframe'); return iframe },
    },
    addEventListener(name: string, listener: (event: any) => void) { if (name === 'message') receive = listener },
    removeEventListener(name: string, listener: (event: any) => void) {
      if (name === 'message' && receive === listener) receive = undefined
    },
  } as any
  return {
    iframe,
    posts,
    load: () => load?.(),
    message(event: string, info?: unknown) {
      receive?.({ origin: 'https://www.youtube-nocookie.com', source: contentWindow, data: JSON.stringify({ event, info }) })
    },
    wasRemoved: () => removed,
    restore: () => { globalThis.window = priorWindow },
  }
}

test('player implementation never requests the blocked youtube.com site', async () => {
  const source = await readFile(new URL('./youtube-player.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /https?:\/\/[^'"`]*youtube\.com/i)
})

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

test('uses only the privacy-enhanced iframe and preserves playback controls', async () => {
  const browser = installNoCookiePlayerWindow()
  const states: string[] = []
  try {
    const pending = createYouTubePlayer('youtube-player', { videoId: 'approved', onReady() {}, onStateChange: state => states.push(state) })
    browser.load()
    browser.message('initialDelivery', { currentTime: 42.5, playerState: 1 })
    const player = await pending

    const embedUrl = new URL(browser.iframe.src)
    assert.equal(embedUrl.origin, 'https://www.youtube-nocookie.com')
    assert.equal(embedUrl.pathname, '/embed/approved')
    assert.equal(embedUrl.searchParams.get('origin'), 'https://ztube.example')
    assert.equal(player.getCurrentTime?.(), 42.5)
    assert.deepEqual(states, ['playing'])

    player.pauseVideo?.()
    player.seekTo?.(30, true)
    assert.ok(browser.posts.some(post => post.message.func === 'pauseVideo'))
    assert.ok(browser.posts.some(post => post.message.func === 'seekTo' && post.message.args[0] === 30))
    assert.ok(browser.posts.every(post => post.targetOrigin === 'https://www.youtube-nocookie.com'))
    player.destroy?.()
  } finally {
    browser.restore()
  }
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

test('rejects with an actionable message when YouTube blocks embedded playback', async () => {
  const browser = installNoCookiePlayerWindow()
  try {
    const pending = createYouTubePlayer('youtube-player', { videoId: 'blocked', onReady() {} })
    browser.message('onError', 150)
    await assert.rejects(pending, /restricted mode, parental controls, or the network/i)
    assert.equal(browser.wasRemoved(), true)
  } finally {
    browser.restore()
  }
})
