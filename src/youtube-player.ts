export interface YouTubePlayer {
  setPlaybackRate(rate: number): void
  getCurrentTime?(): number
  seekTo?(seconds: number, allowSeekAhead?: boolean): void
  pauseVideo?(): void
  destroy?(): void
}

export interface YouTubePlayerOptions {
  videoId: string
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
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
    iframe.allowFullscreen = true
    iframe.style.width = '100%'
    iframe.style.height = '100%'
    iframe.style.border = '0'

    let currentTime = 0
    let lastState: number | undefined
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
      clearInterval(handshake)
      options.onReady(player)
      resolve(player)
    }
    const reportState = (code: number) => {
      if (code === lastState) return
      lastState = code
      options.onStateChange?.(youtubeState(code))
    }
    const fail = (code: number) => {
      if (destroyed) return
      const error = new Error(playbackErrorMessage(code))
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
        fail(message.info)
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
      if (removeFrame) iframe.remove()
    }
    const timeout = setTimeout(() => {
      if (destroyed) return
      cleanup(true)
      reject(new Error('YouTube could not load. Restricted mode, parental controls, or the network may be blocking playback.'))
    }, 12_000)
    const handshake = setInterval(listen, 500)
    iframe.addEventListener('load', listen)
    window.addEventListener('message', receive)
    container.replaceChildren(iframe)
  })
}

export function createPlaybackReporter(options: {
  initialRemainingSeconds: number
  heartbeat: (sequence: number, state: PlaybackState, positionSeconds: number) => Promise<{ remainingSeconds: number; authorized: boolean }>
  pause: () => void
  position?: () => number
  onRemaining: (seconds: number) => void
  document?: Pick<Document, 'hidden' | 'pictureInPictureElement' | 'addEventListener' | 'removeEventListener'>
  intervalMs?: number
  leaseMs?: number
  now?: () => number
}) {
  let sequence = 0
  let state: PlaybackState = 'paused'
  let remaining = options.initialRemainingSeconds
  let stopped = false
  const now = options.now ?? Date.now
  let leaseDeadline = now() + (options.leaseMs ?? 60_000)
  const send = async () => {
    if (stopped) return
    try {
      const response = await options.heartbeat(++sequence, state, Math.max(0, Math.floor(options.position?.() ?? 0)))
      if (stopped) return
      remaining = response.remainingSeconds
      options.onRemaining(remaining)
      if (!response.authorized) { stopped = true; options.pause() }
      else leaseDeadline = now() + (options.leaseMs ?? 60_000)
    } catch {
      if (now() >= leaseDeadline) { stopped = true; options.pause() }
    }
  }
  const document = options.document ?? window.document
  const visibility = () => {
    if (document.hidden && !document.pictureInPictureElement) { options.pause(); state = 'paused'; void send() }
  }
  document.addEventListener('visibilitychange', visibility)
  const timer = setInterval(() => { void send() }, options.intervalMs ?? 15_000)
  options.onRemaining(remaining)
  return {
    setState(next: PlaybackState) { state = next; void send() },
    stop() { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', visibility) },
  }
}
