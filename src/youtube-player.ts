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

type YouTubeWindow = Window & {
  YT?: { Player: new (elementId: string, options: unknown) => YouTubePlayer }
  onYouTubeIframeAPIReady?: () => void
}

let iframeApiPromise: Promise<void> | undefined

function loadIframeApi(browser: YouTubeWindow): Promise<void> {
  if (browser.YT?.Player) return Promise.resolve()
  if (iframeApiPromise) return iframeApiPromise
  iframeApiPromise = new Promise((resolve) => {
    const priorReady = browser.onYouTubeIframeAPIReady
    browser.onYouTubeIframeAPIReady = () => {
      priorReady?.()
      resolve()
    }
    const script = browser.document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    browser.document.head.appendChild(script)
  })
  return iframeApiPromise
}

export async function createYouTubePlayer(elementId: string, options: YouTubePlayerOptions): Promise<YouTubePlayer> {
  const browser = window as YouTubeWindow
  await loadIframeApi(browser)
  return new browser.YT!.Player(elementId, {
    videoId: options.videoId,
    playerVars: { rel: 0, modestbranding: 1, autoplay: 1 },
    events: {
      onReady: (event: { target: YouTubePlayer }) => options.onReady(event.target),
      onStateChange: (event: { data: number }) => options.onStateChange?.(youtubeState(event.data)),
    },
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
