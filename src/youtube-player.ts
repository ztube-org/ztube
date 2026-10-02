export interface YouTubePlayer {
  setPlaybackRate(rate: number): void
  getCurrentTime?(): number
  seekTo?(seconds: number, allowSeekAhead?: boolean): void
  pauseVideo?(): void
  destroy?(): void
}

export interface YouTubePlayerOptions {
  videoId: string
  signal?: AbortSignal
  onReady(player: YouTubePlayer): void
  onStateChange?(state: PlaybackState): void
  onError?(error: Error): void
}

export type PlaybackState = 'playing' | 'paused' | 'buffering' | 'ended'

export function youtubeState(code: number): PlaybackState {
  if (code === 1) return 'playing'
  if (code === 3) return 'buffering'
  if (code === 0) return 'ended'
  return 'paused'
}

export async function authorizeAndCreatePlayer(
  videoId: string,
  authorize: (videoId: string) => Promise<void>,
  create: () => Promise<YouTubePlayer>,
): Promise<YouTubePlayer> {
  await authorize(videoId)
  return create()
}

const NOCOOKIE_ORIGIN = 'https://www.youtube-nocookie.com'

function playbackErrorMessage(code: number): string {
  if (code === 101 || code === 150) return 'This video cannot play here. Restricted mode, parental controls, or the network may be blocking embedded playback.'
  if (code === 100) return 'This video is unavailable or has been removed.'
  if (code === 2) return 'This video link is invalid.'
  return 'YouTube could not start playback. Check parental controls and network restrictions, then try again.'
}

export async function createYouTubePlayer(elementId: string, options: YouTubePlayerOptions): Promise<YouTubePlayer> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new Error('Playback page changed')); return }
    const container = window.document.getElementById(elementId)
    if (!container) {
      reject(new Error('YouTube player container is missing.'))
      return
    }

    const iframe = window.document.createElement('iframe')
    const embedUrl = new URL(`${NOCOOKIE_ORIGIN}/embed/${encodeURIComponent(options.videoId)}`)
    embedUrl.searchParams.set('enablejsapi', '1')
    embedUrl.searchParams.set('origin', window.location.origin)
    embedUrl.searchParams.set('rel', '0')
    embedUrl.searchParams.set('modestbranding', '1')
    embedUrl.searchParams.set('autoplay', '1')
    embedUrl.searchParams.set('playsinline', '1')
    iframe.src = embedUrl.toString()
    iframe.title = 'YouTube video player'
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture 'none'; web-share"
    iframe.allowFullscreen = true
    iframe.style.width = '100%'
    iframe.style.height = '100%'
    iframe.style.border = '0'

    let currentTime = 0
    let lastState: number | undefined
    let lastStatusAt = Date.now()
    let ready = false
    let destroyed = false

    const post = (message: object) => iframe.contentWindow?.postMessage(JSON.stringify(message), NOCOOKIE_ORIGIN)
    const command = (func: string, args: unknown[] = []) => post({ event: 'command', func, args, id: elementId })
    const player: YouTubePlayer = {
      setPlaybackRate: rate => command('setPlaybackRate', [rate]),
      getCurrentTime: () => currentTime,
      seekTo: (seconds, allowSeekAhead = true) => command('seekTo', [seconds, allowSeekAhead]),
      pauseVideo: () => command('pauseVideo'),
      destroy: () => cleanup(true),
    }

    const finishReady = () => {
      if (ready || destroyed) return
      ready = true
      clearTimeout(timeout)
      lastStatusAt = Date.now()
      options.onReady(player)
      resolve(player)
    }
    const reportState = (code: number) => {
      if (![-1, 0, 1, 2, 3, 5].includes(code)) return
      lastStatusAt = Date.now()
      if (code === lastState) return
      lastState = code
      options.onStateChange?.(youtubeState(code))
    }
    const fail = (error: Error) => {
      if (destroyed) return
      cleanup(true)
      options.onError?.(error)
      reject(error)
    }
    const receive = (event: MessageEvent) => {
      if (event.origin !== NOCOOKIE_ORIGIN || event.source !== iframe.contentWindow) return
      let message: { event?: string; info?: unknown }
      try {
        message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      } catch {
        return
      }
      if (!message || typeof message !== 'object') return
      if (message.event === 'onError' && typeof message.info === 'number') {
        fail(new Error(playbackErrorMessage(message.info)))
        return
      }
      if (message.event === 'onStateChange' && typeof message.info === 'number') reportState(message.info)
      if (message.info && typeof message.info === 'object') {
        const info = message.info as { currentTime?: unknown; playerState?: unknown }
        if (typeof info.currentTime === 'number') currentTime = info.currentTime
        if (typeof info.playerState === 'number') reportState(info.playerState)
      }
      if (message.event === 'onReady' || message.event === 'initialDelivery' || message.event === 'infoDelivery') finishReady()
    }
    const listen = () => {
      post({ event: 'listening', id: elementId })
      command('addEventListener', ['onReady'])
      command('addEventListener', ['onStateChange'])
      command('addEventListener', ['onError'])
    }
    const cleanup = (removeFrame: boolean) => {
      if (destroyed) return
      destroyed = true
      clearTimeout(timeout)
      clearInterval(handshake)
      window.removeEventListener('message', receive)
      options.signal?.removeEventListener('abort', abort)
      if (removeFrame) iframe.remove()
    }
    const abort = () => { cleanup(true); reject(new Error('Playback page changed')) }
    const timeout = setTimeout(() => {
      if (destroyed) return
      cleanup(true)
      reject(new Error('YouTube could not load. Restricted mode, parental controls, or the network may be blocking playback.'))
    }, 12_000)
    // Keep requesting a fresh state after startup, including while paused.
    // Server heartbeats alone cannot prove that the iframe is still reporting.
    const handshake = setInterval(() => {
      if (ready && Date.now() - lastStatusAt >= 10_000) {
        fail(new Error('Playback stopped because the video player stopped reporting its state. Please try again.'))
      } else if (ready) post({ event: 'listening', id: elementId })
      else listen()
    }, 500)
    iframe.addEventListener('load', listen)
    window.addEventListener('message', receive)
    options.signal?.addEventListener('abort', abort, { once: true })
    container.replaceChildren(iframe)
  })
}

export type PlaybackStopReason = 'allowance' | 'connection' | 'background' | 'denied'

export function createPlaybackReporter(options: {
  initialRemainingSeconds: number
  heartbeat: (sequence: number, state: PlaybackState, positionSeconds: number, keepalive?: boolean) => Promise<{ sequence: number; remainingSeconds: number; authorized: boolean; leaseExpiresAt?: string | null }>
  pause: () => void
  onBlocked?: (reason: PlaybackStopReason) => void
  position?: () => number
  onRemaining: (seconds: number) => void
  document?: Pick<Document, 'hidden' | 'pictureInPictureElement' | 'addEventListener' | 'removeEventListener'>
  intervalMs?: number
  initialLeaseDeadline?: number
  leaseMs?: number
  now?: () => number
}) {
  let sequence = 0
  let state: PlaybackState = 'paused'
  let remainingMs = options.initialRemainingSeconds * 1000
  let lastServerRemaining = options.initialRemainingSeconds
  let playedMs = 0
  let stopped = false
  let blocked = false
  let sending = false
  let sendQueued = false
  const now = options.now ?? Date.now
  const document = options.document ?? window.document
  const leaseMs = options.leaseMs ?? 60_000
  let lastTick = now()
  let leaseDeadline = options.initialLeaseDeadline ?? lastTick + leaseMs
  let requestDeadline = Infinity
  let watchdog: ReturnType<typeof setTimeout>
  let cancelRequest: (() => void) | undefined
  const publish = () => options.onRemaining(Math.ceil(remainingMs / 1000))
  const account = () => {
    const instant = now()
    if (state === 'playing') {
      const elapsed = Math.max(0, instant - lastTick)
      playedMs += elapsed
      remainingMs = Math.max(0, remainingMs - elapsed)
    }
    lastTick = instant
    publish()
  }
  const stop = () => {
    stopped = true
    clearInterval(timer)
    clearTimeout(watchdog)
    cancelRequest?.()
    document.removeEventListener('visibilitychange', visibility)
  }
  const finalHeartbeat = () => {
    const position = Math.max(0, Math.floor(options.position?.() ?? 0))
    // Supersede an in-flight playing heartbeat, including when stopping locally.
    void options.heartbeat(++sequence, state === 'ended' ? 'ended' : 'paused', position, true).catch(() => undefined)
  }
  const block = (reason: PlaybackStopReason) => {
    if (stopped) return
    blocked = true
    stop()
    finalHeartbeat()
    options.pause()
    options.onBlocked?.(reason)
  }
  const check = () => {
    if (stopped) return false
    account()
    if (document.hidden) block('background')
    else if (remainingMs <= 0) block('allowance')
    else if (now() >= leaseDeadline || now() >= requestDeadline) block('connection')
    return !stopped
  }
  const arm = () => {
    clearTimeout(watchdog)
    if (stopped) return
    const delay = Math.min(1000, leaseDeadline - now(), requestDeadline - now(), state === 'playing' ? remainingMs : Infinity)
    watchdog = setTimeout(() => { if (check()) arm() }, Math.max(1, delay))
  }
  const send = async (): Promise<boolean> => {
    if (!check()) return false
    if (sending) { sendQueued = true; return false }
    sending = true
    const sentSequence = ++sequence
    const sentAt = now()
    const playedAtSend = playedMs
    requestDeadline = sentAt + 5000
    arm()
    try {
      const cancelled = new Promise<null>(resolve => { cancelRequest = () => resolve(null) })
      const response = await Promise.race([options.heartbeat(sentSequence, state, Math.max(0, Math.floor(options.position?.() ?? 0))), cancelled])
      if (!response || !check()) return false
      if (!response.authorized || response.sequence !== sentSequence) {
        remainingMs = Math.min(remainingMs, Math.max(0, response.remainingSeconds * 1000))
        publish()
        block('denied')
        return false
      }
      // Never restore time spent locally while a request was in flight. A
      // genuinely larger server balance permits an extension or a new day.
      const serverRemainingMs = Math.max(0, response.remainingSeconds * 1000 - (playedMs - playedAtSend))
      remainingMs = response.remainingSeconds > lastServerRemaining ? serverRemainingMs : Math.min(remainingMs, serverRemainingMs)
      lastServerRemaining = response.remainingSeconds
      const serverDeadline = response.leaseExpiresAt ? Date.parse(response.leaseExpiresAt) : NaN
      leaseDeadline = Number.isFinite(serverDeadline) ? Math.min(serverDeadline, sentAt + leaseMs) : sentAt + leaseMs
      return check()
    } catch {
      // A failed playing transition must not become an unmetered 60-second lease.
      block('connection')
      return false
    } finally {
      sending = false
      requestDeadline = Infinity
      cancelRequest = undefined
      arm()
      if (!stopped && sendQueued) { sendQueued = false; void send() }
    }
  }
  const visibility = () => { if (check()) { arm(); void send() } }
  document.addEventListener('visibilitychange', visibility)
  const timer = setInterval(() => { void send() }, options.intervalMs ?? 15_000)
  arm()
  publish()
  return {
    // Verify the reporting connection before exposing a playable media element.
    connect: send,
    finish() {
      if (stopped) return
      account()
      stop()
      finalHeartbeat()
    },
    setState(next: PlaybackState) {
      if (stopped) {
        if (blocked && next === 'playing') options.pause()
        return
      }
      if (!check()) return
      state = next
      arm()
      void send()
    },
    stop,
  }
}
