import { createNativePlayer, nativePlaybackCapabilities } from '../../src/native-player'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { apiFetch, ApiError } from '../../src/api'
import type { EpisodeClaimPrompt, UsageBucket } from '../../src/domain'
import { authorizeAndCreatePlayer, createPlaybackReporter, createYouTubePlayer, type PlaybackState, type YouTubePlayer } from '../../src/youtube-player'

type PlaybackAuthorization = {
  playerKind?: 'youtube' | 'native'
  leaseExpiresAt: string
  sessionId: string
  remainingSeconds: number
  timePoolName?: string
  usageBucket: UsageBucket
  resumeAt: number
  favorite: boolean
  videoTitle: string
  videoDescription: string
  channelTitle: string
}

export function useWatchPlayback(videoId: string) {
  const player = ref<YouTubePlayer | null>(null)
  const playbackError = ref<string | null>(null)
  const playbackStopped = ref(false)
  const remainingSeconds = ref<number | null>(null)
  const timePoolName = ref('')
  const usageBucket = ref<UsageBucket>('restricted')
  const favorite = ref(false)
  const videoTitle = ref('')
  const videoDescription = ref('')
  const channelTitle = ref('')
  const claimPrompt = ref<EpisodeClaimPrompt | null>(null)
  const claimPending = ref(false)
  const claimError = ref('')
  let reporter: ReturnType<typeof createPlaybackReporter> | null = null
  let playbackState: PlaybackState = 'paused'
  let disposed = false
  const abort = new AbortController()

  const warning = computed(() => {
    if (remainingSeconds.value === null) return null
    if (remainingSeconds.value <= 0 && timePoolName.value) return `Today’s ${timePoolName.value} time is used up.`
    if (remainingSeconds.value <= 0 && usageBucket.value === 'cartoon') return 'Today’s Cartoon Time is used up.'
    if (remainingSeconds.value <= 0) return usageBucket.value === 'exempt' ? 'Today’s Safety Cap is used up.' : 'Today’s Daily Allowance is used up.'
    if (remainingSeconds.value <= 60) return '1 minute remaining'
    if (remainingSeconds.value <= 300) return '5 minutes remaining'
    if (remainingSeconds.value <= 600) return '10 minutes remaining'
    return null
  })

  function formatRemaining(seconds: number) {
    const minutes = Math.floor(seconds / 60)
    const remainder = seconds % 60
    return `${minutes}:${remainder.toString().padStart(2, '0')}`
  }

  onMounted(() => {
    window.scrollTo?.(0, 0)
    window.addEventListener('pagehide', leave)
    window.addEventListener('pageshow', restore)
    return startPlayback()
  })

  async function startPlayback() {
    playbackError.value = null
    try {
      let authorization!: PlaybackAuthorization
      player.value = await authorizeAndCreatePlayer(
        videoId,
        async requestedVideoId => {
          const response = await apiFetch<{ authorization: PlaybackAuthorization }>('/api/child/playback-authorizations', { method: 'POST', body: { videoId: requestedVideoId } })
          authorization = response.authorization
          claimPrompt.value = null
          usageBucket.value = authorization.usageBucket
          timePoolName.value = authorization.timePoolName ?? ''
          favorite.value = authorization.favorite
          videoTitle.value = authorization.videoTitle
          videoDescription.value = authorization.videoDescription
          channelTitle.value = authorization.channelTitle
        },
        () => {
          if (disposed) throw new Error('Playback page changed')
          if (authorization.playerKind === 'native') return Promise.resolve(createNativePlayer('youtube-player', {
            signal: abort.signal, resumeAt: authorization.resumeAt,
            resolveUrl: async () => {
              const path = `/api/child/playback-authorizations/${authorization.sessionId}/media`
              // Let a late response arrive so its exact Remux session can be
              // released even when the Child has already left this page.
              const capabilities = nativePlaybackCapabilities()
              const params = new URLSearchParams({ codecs: capabilities.codecs.join(','), nativeCodecs: capabilities.nativeCodecs.join(','), preferNativeHls: capabilities.preferNativeHls ? '1' : '0' })
              const media = await apiFetch<{ url: string; transport?: 'hls'; hlsEngine?: 'native' | 'mse'; cleanupId?: string }>(`${path}?${params}`)
              let released = false
              return { ...media, release: () => {
                if (released || !media.cleanupId) return
                released = true
                void apiFetch(`${path}/${encodeURIComponent(media.cleanupId)}/stop`, { method: 'POST', keepalive: true }).catch(() => undefined)
              } }
            },
            onStateChange: state => { playbackState = state; reporter?.setState(state) },
            onError: error => { reporter?.finish(); playbackError.value = error.message },
          }))
          return createYouTubePlayer('youtube-player', {
            videoId,
            signal: abort.signal,
            onReady: readyPlayer => {
              if (authorization.resumeAt >= 30) readyPlayer.seekTo?.(authorization.resumeAt, true)
            },
            onStateChange: (state: PlaybackState) => {
              playbackState = state
              reporter?.setState(state)
            },
            onError: error => { reporter?.finish(); playbackError.value = error.message },
          })
        },
      )
      if (disposed) {
        player.value.destroy?.()
        return
      }
      reporter = createPlaybackReporter({
        initialRemainingSeconds: authorization.remainingSeconds,
        initialLeaseDeadline: Number.isFinite(Date.parse(authorization.leaseExpiresAt)) ? Date.parse(authorization.leaseExpiresAt) : undefined,
        heartbeat: (sequence, state, positionSeconds, keepalive) => apiFetch(`/api/child/playback-authorizations/${authorization.sessionId}/heartbeats`, { method: 'POST', keepalive, body: { sequence, state, positionSeconds } }),
        pause: () => player.value?.pauseVideo?.(),
        onBlocked: () => {
          playbackStopped.value = true
          player.value?.destroy?.()
        },
        position: () => player.value?.getCurrentTime?.() ?? 0,
        onRemaining: seconds => { remainingSeconds.value = seconds },
      })
      // Autoplay can report its first state before the player promise resolves.
      reporter.setState(playbackState)
    } catch (error) {
      if (disposed) return
      if (error instanceof ApiError && error.response.code === 'episode-claim-required') {
        claimPrompt.value = error.response.claim as EpisodeClaimPrompt
      } else playbackError.value = error instanceof Error ? error.message : 'Playback could not be authorized'
    }
  }

  async function confirmClaim() {
    if (!claimPrompt.value || claimPending.value || disposed) return
    claimPending.value = true
    claimError.value = ''
    try {
      await apiFetch('/api/child/episode-claims', { method: 'POST', body: { videoId, confirmed: true, viewingDay: claimPrompt.value.viewingDay } })
      if (disposed) return
      claimPrompt.value = null
      await startPlayback()
    } catch (error) {
      if (disposed) return
      claimError.value = error instanceof Error ? error.message : 'Unable to claim this episode. Please try again.'
      // Refresh the prompt after a competing claim or local midnight. A fresh
      // confirmation is required; never automatically spend another day's slot.
      await startPlayback()
    } finally { claimPending.value = false }
  }

  function leave() {
    disposed = true
    reporter?.finish()
    abort.abort()
    player.value?.destroy?.()
  }
  function restore(event: PageTransitionEvent) {
    if (event.persisted) window.location.reload()
  }
  onBeforeUnmount(() => {
    leave()
    window.removeEventListener('pagehide', leave)
    window.removeEventListener('pageshow', restore)
  })

  return { favorite, playbackError, playbackStopped, remainingSeconds, usageBucket, timePoolName, videoTitle, videoDescription, channelTitle, warning, formatRemaining, claimPrompt, claimPending, claimError, confirmClaim }
}
