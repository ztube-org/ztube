import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import * as vue from 'vue'
import * as youtubePlayer from './youtube-player.ts'
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
      hidden: false,
      pictureInPictureElement: null,
      addEventListener() {},
      removeEventListener() {},
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

// Execute the watch page’s playback lifecycle with an isolated iframe/API.
async function watchPage(heartbeat: (sequence: number, state: string) => unknown) {
  const script = await readFile(new URL('../app/composables/use-watch-playback.ts', import.meta.url), 'utf8')
  let mounted!: () => Promise<void>
  let unmount!: () => void
  const modules: Record<string, unknown> = {
    vue: { ...vue, onMounted: (fn: typeof mounted) => { mounted = fn }, onBeforeUnmount: (fn: typeof unmount) => { unmount = fn } },
    'vue-router': { useRoute: () => ({ query: { v: 'approved' } }) },
    '../components/ThemeToggle.vue': {},
    '../../src/youtube-player': youtubePlayer,
    '../../src/native-player': { createNativePlayer: () => { throw new Error('YouTube must not create a native player') } },
    '../../src/api': {
      useAuth: () => ({ logout() {} }),
      apiFetch: async (url: string, options: { body: { sequence: number; state: string } }) => {
        if (url.endsWith('/heartbeats')) return heartbeat(options.body.sequence, options.body.state)
        return { authorization: { sessionId: 'session', remainingSeconds: 3600, usageBucket: 'restricted', resumeAt: 0 } }
      },
    },
  }
  const compiled = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const exports: { useWatchPlayback?: (id: string) => unknown } = {}
  new Function('require', 'exports', compiled.outputText)((name: string) => {
    assert.ok(name in modules, `Unexpected import: ${name}`)
    return modules[name]
  }, exports)
  exports.useWatchPlayback!('approved')
  return { mount: mounted, unmount }
}

test('watch page counts autoplay delivered before reporter initialization', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  const browser = installNoCookiePlayerWindow()
  const states: string[] = []
  const page = await watchPage((sequence, state) => {
    states.push(state)
    return { sequence, remainingSeconds: 3600, authorized: true }
  })
  try {
    const mounting = page.mount()
    await new Promise(resolve => setImmediate(resolve))
    browser.message('initialDelivery', { currentTime: 0, playerState: 1 })
    await mounting
    for (let i = 1; i <= 721; i++) {
      browser.message('infoDelivery', { currentTime: i * 15, playerState: 1 })
      t.mock.timers.tick(15_000)
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.ok(states.length >= 721)
    assert.ok(states.every(state => state === 'playing'), 'autoplay must never be reported as paused')
  } finally { page.unmount(); browser.restore() }
})

test('watch page removes the playable iframe when authorization ends', async () => {
  const browser = installNoCookiePlayerWindow()
  const page = await watchPage(sequence => ({ sequence, remainingSeconds: 0, authorized: false }))
  try {
    const mounting = page.mount()
    await new Promise(resolve => setImmediate(resolve))
    browser.message('initialDelivery', { currentTime: 0, playerState: 2 })
    await mounting
    browser.message('onStateChange', 1)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(browser.wasRemoved(), true, 'an exhausted player must not retain its Play control')
  } finally { page.unmount(); browser.restore() }
})

for (const cause of ['denied', 'offline'] as const) {
  test(`cannot restart playback after authorization is ${cause}`, async t => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
    let paused = 0
    let blocked = 0
    let heartbeats = 0
    const reporter = createPlaybackReporter({
      initialRemainingSeconds: 1,
      document: { hidden: false, pictureInPictureElement: null, addEventListener() {}, removeEventListener() {} } as any,
      pause: () => { paused++ }, onRemaining() {},
      onBlocked: () => { blocked++ },
      heartbeat: async sequence => {
        heartbeats++
        if (cause === 'offline') throw new Error('offline')
        return { sequence, remainingSeconds: 0, authorized: false }
      },
    })
    try {
      reporter.setState('playing')
      await Promise.resolve()
      if (cause === 'offline') t.mock.timers.tick(60_000)
      assert.equal(paused, 1)
      assert.equal(blocked, 1)
      const requestsAtStop = heartbeats
      reporter.setState('paused')
      reporter.setState('playing')
      assert.equal(paused, 2)
      t.mock.timers.tick(120_000)
      assert.equal(heartbeats, requestsAtStop)
      assert.equal(blocked, 1)
    } finally { reporter.stop() }
  })
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
    heartbeat: async (sequence, state) => { states.push(state); return { sequence, remainingSeconds: 0, authorized: false } },
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

test('serializes heartbeats so an older denial cannot overtake a newer acknowledgement', async () => {
  const calls: number[] = []
  const resolvers = new Map<number, (response: { sequence: number; remainingSeconds: number; authorized: boolean }) => void>()
  let paused = 0
  const reporter = createPlaybackReporter({
    initialRemainingSeconds: 120,
    document: { hidden: false, pictureInPictureElement: null, addEventListener() {}, removeEventListener() {} } as any,
    intervalMs: 60_000,
    pause: () => { paused++ },
    onRemaining() {},
    heartbeat: sequence => new Promise(resolve => { calls.push(sequence); resolvers.set(sequence, resolve) }),
  })
  reporter.setState('playing')
  reporter.setState('paused')
  assert.deepEqual(calls, [1])
  resolvers.get(1)?.({ sequence: 1, remainingSeconds: 119, authorized: true })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(calls, [1, 2])
  resolvers.get(2)?.({ sequence: 2, remainingSeconds: 119, authorized: true })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(paused, 0)
  reporter.stop()
})

test('pauses when a heartbeat remains pending beyond the lease', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
  let paused = 0
  const reporter = createPlaybackReporter({
    initialRemainingSeconds: 120,
    document: { hidden: false, pictureInPictureElement: null, addEventListener() {}, removeEventListener() {} } as any,
    intervalMs: 60_000,
    leaseMs: 10,
    pause: () => { paused++ },
    onRemaining() {},
    heartbeat: () => new Promise(() => {}),
  })
  try {
    reporter.setState('playing')
    t.mock.timers.tick(10)
    assert.equal(paused, 1)
  } finally { reporter.stop() }
})

test('an early watchdog callback retries until the playback lease expires', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] })
  let now = 0
  let paused = 0
  const reporter = createPlaybackReporter({
    initialRemainingSeconds: 120,
    document: { hidden: false, pictureInPictureElement: null, addEventListener() {}, removeEventListener() {} } as any,
    intervalMs: 60_000,
    leaseMs: 10,
    now: () => now,
    pause: () => { paused++ },
    onRemaining() {},
    heartbeat: () => new Promise(() => {}),
  })
  try {
    reporter.setState('playing')
    now = 9
    t.mock.timers.tick(10)
    assert.equal(paused, 0, 'the timer may fire before the wall-clock deadline')
    now = 10
    t.mock.timers.tick(1)
    assert.equal(paused, 1, 'an early callback must not discard the only lease watchdog')
  } finally { reporter.stop() }
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

for (const exit of ['back', 'error'] as const) {
  test(`watch page submits final paused state after ${exit} and sends no later playing heartbeat`, async t => {
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] })
    const browser = installNoCookiePlayerWindow()
    const states: string[] = []
    const page = await watchPage((sequence, state) => {
      states.push(state)
      return { sequence, remainingSeconds: 3600, authorized: true }
    })
    try {
      const mounting = page.mount()
      await new Promise(resolve => setImmediate(resolve))
      browser.message('initialDelivery', { currentTime: 45, playerState: 1 })
      await mounting
      if (exit === 'back') page.unmount()
      else browser.message('onError', 100)
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(states.at(-1), 'paused')
      const requestsAtExit = states.length
      t.mock.timers.tick(60_000)
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(states.length, requestsAtExit)
      assert.equal(browser.wasRemoved(), true)
    } finally { page.unmount(); browser.restore() }
  })
}

test('final pause supersedes a pending playing heartbeat and captures progress before destruction', async () => {
  const calls: Array<{ sequence: number; state: string; position: number; keepalive?: boolean }> = []
  let first!: (value: { sequence: number; remainingSeconds: number; authorized: boolean }) => void
  let position = 45
  const reporter = createPlaybackReporter({
    initialRemainingSeconds: 120,
    document: { hidden: false, pictureInPictureElement: null, addEventListener() {}, removeEventListener() {} } as any,
    pause() {}, onRemaining() {}, position: () => position,
    heartbeat: (sequence, state, position, keepalive) => {
      calls.push({ sequence, state, position, keepalive })
      if (sequence === 1) return new Promise(resolve => { first = resolve })
      return Promise.resolve({ sequence, remainingSeconds: 120, authorized: true })
    },
  })
  reporter.setState('playing')
  reporter.finish()
  position = 0
  reporter.finish()
  assert.deepEqual(calls, [
    { sequence: 1, state: 'playing', position: 45, keepalive: undefined },
    { sequence: 2, state: 'paused', position: 45, keepalive: true },
  ])
  first({ sequence: 1, remainingSeconds: 120, authorized: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 2)
})

test('leaving before YouTube is ready immediately removes its iframe and rejects startup', async () => {
  const browser = installNoCookiePlayerWindow()
  const abort = new AbortController()
  try {
    const pending = createYouTubePlayer('youtube-player', { videoId: 'approved', signal: abort.signal, onReady() {} })
    abort.abort()
    await assert.rejects(pending, /Playback page changed/)
    assert.equal(browser.wasRemoved(), true)
  } finally { browser.restore() }
})

test('completion queued behind an in-flight heartbeat is still delivered when leaving', async () => {
  const calls: Array<{ sequence: number; state: string }> = []
  let acknowledge!: (response: { sequence: number; remainingSeconds: number; authorized: boolean }) => void
  const reporter = createPlaybackReporter({
    initialRemainingSeconds: 120,
    document: { hidden: false, pictureInPictureElement: null, addEventListener() {}, removeEventListener() {} } as any,
    pause() {}, onRemaining() {},
    heartbeat: (sequence, state) => {
      calls.push({ sequence, state })
      return sequence === 1 ? new Promise(resolve => { acknowledge = resolve }) : Promise.resolve({ sequence, remainingSeconds: 120, authorized: false })
    },
  })
  reporter.setState('playing')
  reporter.setState('ended')
  reporter.finish()
  assert.deepEqual(calls, [{ sequence: 1, state: 'playing' }, { sequence: 2, state: 'ended' }])
  acknowledge({ sequence: 1, remainingSeconds: 120, authorized: true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls.length, 2)
})
