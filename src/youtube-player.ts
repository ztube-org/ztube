export interface YouTubePlayer {
  setPlaybackRate(rate: number): void
  destroy?(): void
}

export interface YouTubePlayerOptions {
  videoId: string
  onReady(player: YouTubePlayer): void
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
    events: { onReady: (event: { target: YouTubePlayer }) => options.onReady(event.target) },
  })
}
