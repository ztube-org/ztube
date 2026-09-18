import type Hls from 'hls.js'
import type { YouTubePlayer, PlaybackState } from './youtube-player'

export type NativeMedia = { url: string; transport?: 'hls'; hlsEngine?: 'native' | 'mse'; release?: () => void }

function supportsNativeHls(video: HTMLVideoElement) {
  return Boolean(video.canPlayType('application/vnd.apple.mpegurl') || video.canPlayType('application/x-mpegURL'))
}
function preferNativeHls(video: HTMLVideoElement) {
  return supportsNativeHls(video) && /Apple/.test(navigator.vendor)
}
export function nativePlaybackCapabilities() {
  const video = document.createElement('video')
  const types: Record<string, string> = {
    h264: 'video/mp4; codecs="avc1.4d4028"', hevc: 'video/mp4; codecs="hvc1.1.6.L120.B0"',
    aac: 'audio/mp4; codecs="mp4a.40.2"', mp3: 'audio/mp4; codecs="mp4a.40.34"',
    ac3: 'audio/mp4; codecs="ac-3"', eac3: 'audio/mp4; codecs="ec-3"',
  }
  // Native media and MSE are different decoding paths, even in the same
  // browser. Report them separately; never combine codecs across engines.
  const codecs = Object.entries(types).filter(([, type]) => typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type)).map(([codec]) => codec)
  const nativeCodecs = supportsNativeHls(video) ? Object.entries(types).filter(([, type]) => Boolean(video.canPlayType(type))).map(([codec]) => codec) : []
  return { codecs, nativeCodecs, preferNativeHls: preferNativeHls(video) }
}
export function nativePlaybackCodecs() {
  const capabilities = nativePlaybackCapabilities()
  return capabilities.preferNativeHls ? capabilities.nativeCodecs : capabilities.codecs
}

// Native playback implements the same small controls used by the lease reporter.
export function createNativePlayer(elementId: string, options: {
  resolveUrl: () => Promise<string | NativeMedia>
  signal: AbortSignal
  resumeAt: number
  onStateChange: (state: PlaybackState) => void
  onError: (error: Error) => void
}): YouTubePlayer {
  const container = document.getElementById(elementId)
  if (!container) throw new Error('Video player container is missing')
  const video = document.createElement('video')
  video.controls = true
  video.playsInline = true
  video.preload = 'metadata'
  video.setAttribute('controlsList', 'nodownload noremoteplayback')
  video.disableRemotePlayback = true
  video.style.width = '100%'
  video.style.height = '100%'
  let media: NativeMedia | undefined
  let hls: Hls | undefined
  let destroyed = false
  let refreshed = false
  let resume = options.resumeAt
  const state = (value: PlaybackState) => { if (!destroyed) options.onStateChange(value) }
  video.addEventListener('playing', () => {
    if (document.hidden && !document.pictureInPictureElement) { video.pause(); state('paused') }
    else state('playing')
  })
  video.addEventListener('pause', () => state(video.ended ? 'ended' : 'paused'))
  video.addEventListener('ended', () => { state('ended'); player.destroy?.() })
  video.addEventListener('waiting', () => state(video.paused ? 'paused' : 'buffering'))
  video.addEventListener('seeking', () => state(video.paused ? 'paused' : 'buffering'))
  video.addEventListener('seeked', () => state(video.paused ? 'paused' : video.readyState >= 3 ? 'playing' : 'buffering'))
  video.addEventListener('loadedmetadata', () => {
    if (resume >= 30 && Number.isFinite(video.duration)) video.currentTime = Math.min(resume, Math.max(0, video.duration - 1))
    // iPad may require the Child to tap Play; a rejected autoplay is harmless.
    void video.play().catch(() => state('paused'))
  })
  async function load() {
    try {
      hls?.destroy(); hls = undefined
      media?.release?.(); media = undefined
      const resolved = await options.resolveUrl()
      const next = typeof resolved === 'string' ? { url: resolved } : resolved
      if (destroyed || options.signal.aborted) { next.release?.(); return }
      media = next
      if (next.transport === 'hls') video.crossOrigin = 'anonymous'
      else video.removeAttribute('crossorigin')
      if (next.transport === 'hls' && (next.hlsEngine ? next.hlsEngine === 'mse' : !preferNativeHls(video))) {
        const { default: HlsPlayer } = await import('hls.js')
        if (destroyed || options.signal.aborted) return
        if (!HlsPlayer.isSupported()) throw new Error('This browser cannot play this video stream. Try Safari on an Apple device.')
        hls = new HlsPlayer({ maxBufferLength: 30, backBufferLength: 30, enableWorker: true })
        hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
          if (!data.fatal || destroyed) return
          player.destroy?.()
          options.onError(new Error('The video stream could not be played. Check the Jellyfin connection, or try Safari for Dolby audio.'))
        })
        hls.loadSource(next.url)
        hls.attachMedia(video)
      } else {
        video.src = next.url
        video.load()
      }
    } catch (error) {
      if (!destroyed) { player.destroy?.(); options.onError(error instanceof Error ? error : new Error('Video is unavailable')) }
    }
  }
  video.addEventListener('error', () => {
    if (destroyed) return
    if (!refreshed && video.error?.code === MediaError.MEDIA_ERR_NETWORK) {
      refreshed = true
      resume = video.currentTime
      state('buffering')
      void load()
    } else {
      player.destroy?.()
      options.onError(new Error('The video could not be loaded. Please try again. If it keeps failing, ask an Admin to check the media connection and video format.'))
    }
  })
  const player: YouTubePlayer = {
    setPlaybackRate: rate => { video.playbackRate = rate },
    getCurrentTime: () => video.currentTime,
    seekTo: seconds => { video.currentTime = seconds },
    pauseVideo: () => video.pause(),
    destroy: () => {
      if (destroyed) return
      destroyed = true
      options.signal.removeEventListener('abort', abort)
      hls?.destroy(); hls = undefined
      media?.release?.(); media = undefined
      video.pause()
      video.removeAttribute('src')
      video.load()
      video.remove()
    },
  }
  const abort = () => player.destroy?.()
  options.signal.addEventListener('abort', abort, { once: true })
  if (options.signal.aborted) { player.destroy?.(); return player }
  container.replaceChildren(video)
  void load()
  return player
}
