<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { apiFetch, useApi, useAuth } from '../../src/api'
import { authorizeAndCreatePlayer, createPlaybackReporter, createYouTubePlayer, type PlaybackState, type YouTubePlayer } from '../../src/youtube-player'

const route = useRoute()
const videoId = route.query.v as string
const playlistParam = route.query.playlist as string | undefined
const channelParam = route.query.channel as string | undefined

const { logout } = useAuth()

type RelatedVideo = {
  videoId: string
  videoTitle: string
  videoThumbnail: string
  duration: number | null
  channelTitle: string | null
}

type RelatedSource = {
  channel?: { title: string }
  playlist?: { title: string }
  videos: RelatedVideo[]
}

type PlaybackAuthorization = {
  sessionId: string
  remainingSeconds: number
  usageBucket: 'restricted' | 'exempt'
  resumeAt: number
  favorite: boolean
  videoTitle: string
  videoDescription: string
  channelTitle: string
}

const relatedSourceUrl = playlistParam
  ? `/api/child/playlist/${playlistParam}/videos`
  : channelParam
    ? `/api/child/channel/${channelParam}/videos`
    : null
const relatedData = relatedSourceUrl
  ? useApi<RelatedSource>(relatedSourceUrl)
  : { data: ref<RelatedSource | null>(null) }
const relatedVideos = computed(() => relatedData.data.value?.videos ?? [])
const relatedTitle = computed(() => relatedData.data.value?.playlist?.title ?? relatedData.data.value?.channel?.title ?? 'More videos')
const relatedKind = playlistParam ? 'Playlist' : 'Channel'
const backTarget = playlistParam
  ? `/browse/playlist/${playlistParam}`
  : channelParam
    ? `/browse/channel/${channelParam}`
    : '/browse'

function watchLocation(relatedVideoId: string) {
  return {
    path: '/watch',
    query: {
      v: relatedVideoId,
      ...(playlistParam ? { playlist: playlistParam } : {}),
      ...(channelParam ? { channel: channelParam } : {}),
    },
  }
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

const player = ref<YouTubePlayer | null>(null)
const playbackError = ref<string | null>(null)
const remainingSeconds = ref<number | null>(null)
const usageBucket = ref<'restricted' | 'exempt'>('restricted')
const favorite = ref(false)
const videoTitle = ref('')
const videoDescription = ref('')
const channelTitle = ref('')
const descriptionExpanded = ref(false)
let reporter: ReturnType<typeof createPlaybackReporter> | null = null
let disposed = false

const warning = computed(() => {
  if (remainingSeconds.value === null) return null
  if (remainingSeconds.value <= 0) return 'Today’s Daily Allowance is used up.'
  if (remainingSeconds.value <= 60) return '1 minute remaining'
  if (remainingSeconds.value <= 300) return '5 minutes remaining'
  if (remainingSeconds.value <= 600) return '10 minutes remaining'
  return null
})

function formatRemaining(seconds: number) {
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}

onMounted(async () => {
  try {
    let authorization!: PlaybackAuthorization
    player.value = await authorizeAndCreatePlayer(
      videoId,
      async requestedVideoId => {
        const response = await apiFetch<{ authorization: PlaybackAuthorization }>('/api/child/playback-authorizations', { method: 'POST', body: { videoId: requestedVideoId } })
        authorization = response.authorization
        usageBucket.value = authorization.usageBucket
        favorite.value = authorization.favorite
        videoTitle.value = authorization.videoTitle
        videoDescription.value = authorization.videoDescription
        channelTitle.value = authorization.channelTitle
      },
      () => {
        if (disposed) throw new Error('Playback page changed')
        return createYouTubePlayer('youtube-player', {
          videoId,
          onReady: readyPlayer => {
            if (authorization.resumeAt >= 30) readyPlayer.seekTo?.(authorization.resumeAt, true)
          },
          onStateChange: (state: PlaybackState) => reporter?.setState(state),
          onError: error => { playbackError.value = error.message },
        })
      },
    )
    reporter = createPlaybackReporter({
      initialRemainingSeconds: authorization.remainingSeconds,
      heartbeat: (sequence, state, positionSeconds) => apiFetch(`/api/child/playback-authorizations/${authorization.sessionId}/heartbeats`, { method: 'POST', body: { sequence, state, positionSeconds } }),
      pause: () => player.value?.pauseVideo?.(),
      position: () => player.value?.getCurrentTime?.() ?? 0,
      onRemaining: seconds => { remainingSeconds.value = seconds },
    })
  } catch (error) {
    if (!disposed) playbackError.value = error instanceof Error ? error.message : 'Playback could not be authorized'
  }
})

onBeforeUnmount(() => {
  disposed = true
  reporter?.stop()
  player.value?.destroy?.()
})

async function toggleFavorite() {
  if (favorite.value) {
    await apiFetch(`/api/child/favorites/${encodeURIComponent(videoId)}`, { method: 'DELETE' })
    favorite.value = false
  } else {
    await apiFetch('/api/child/favorites', { method: 'POST', body: { videoId } })
    favorite.value = true
  }
}

</script>

<template>
  <div class="min-h-screen bg-[#f9f9f9] text-[#0f0f0f]">
    <header class="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-gray-200 bg-white/95 px-3 backdrop-blur sm:px-5">
      <NuxtLink :to="backTarget" class="flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-medium hover:bg-gray-100">
        <UIcon name="i-heroicons-arrow-left" class="h-5 w-5" />
        Back
      </NuxtLink>
      <span class="flex items-center gap-2 text-lg font-bold"><span class="flex h-7 w-9 items-center justify-center rounded-md bg-[#065fd4] text-white"><UIcon name="i-heroicons-play-solid" class="h-4 w-4" /></span>ZTube</span>
      <UButton color="neutral" variant="ghost" size="sm" @click="logout">
        Logout
      </UButton>
    </header>

    <div class="zt-watch-shell">
      <div class="zt-watch-layout" :class="{ 'zt-watch-layout--solo': !relatedVideos.length }">
        <main class="min-w-0">
          <div class="zt-watch-player">
            <div v-if="!playbackError" id="youtube-player" class="h-full w-full"></div>
            <div v-else class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-white" role="alert">
              <UIcon name="i-heroicons-exclamation-triangle" class="h-8 w-8 text-amber-400" />
              <p class="max-w-xl font-medium">{{ playbackError }}</p>
              <p class="max-w-xl text-sm text-gray-300">If Screen Time is enabled, ask the Admin to allow YouTube embedded videos, then reload this page.</p>
            </div>
          </div>

          <div class="border-b border-gray-200 bg-white p-3 sm:mt-3 sm:rounded-xl sm:border sm:p-4">
            <div class="flex items-center justify-between gap-4">
              <div class="min-w-0">
                <p v-if="usageBucket === 'exempt'" class="text-sm font-medium text-[#065fd4]">Safety Cap only</p>
                <p v-if="remainingSeconds !== null" class="text-base font-semibold sm:text-lg">{{ formatRemaining(remainingSeconds) }} {{ usageBucket === 'exempt' ? 'Safety Cap' : 'Daily Allowance' }} remaining</p>
                <p v-if="warning" class="text-sm font-medium text-amber-600" role="alert">{{ warning }}</p>
              </div>
              <UButton :icon="favorite ? 'i-heroicons-star-solid' : 'i-heroicons-star'" :variant="favorite ? 'solid' : 'soft'" @click="toggleFavorite">
                {{ favorite ? 'Favorited' : 'Favorite' }}
              </UButton>
            </div>
          </div>

          <section v-if="videoTitle || videoDescription" class="border-b border-gray-200 bg-white p-3 sm:mt-3 sm:rounded-xl sm:border sm:p-4" aria-label="Video details">
            <h1 class="text-lg font-semibold leading-6">{{ videoTitle }}</h1>
            <p v-if="channelTitle" class="mt-1 text-sm text-[#606060]">{{ channelTitle }}</p>
            <h2 v-if="videoDescription" id="video-description-heading" class="mt-4 text-sm font-semibold">Description</h2>
            <p v-if="videoDescription" class="mt-1 whitespace-pre-wrap text-sm leading-5 text-[#606060]" :class="{ 'line-clamp-3': !descriptionExpanded }">{{ videoDescription }}</p>
            <button v-if="videoDescription.length > 240" type="button" class="mt-1 min-h-11 rounded-lg text-sm font-semibold text-[#065fd4]" @click="descriptionExpanded = !descriptionExpanded">
              {{ descriptionExpanded ? 'Show less' : 'Show more' }}
            </button>
          </section>
        </main>

        <aside v-if="relatedVideos.length" class="zt-watch-related zt-panel" :aria-label="`${relatedKind} videos`">
          <div class="border-b border-gray-200 px-4 py-3">
            <p class="text-xs font-semibold uppercase tracking-wide text-[#606060]">{{ relatedKind }}</p>
            <h2 class="truncate font-semibold">{{ relatedTitle }}</h2>
            <p class="text-sm text-[#606060]">{{ relatedVideos.length }} videos</p>
          </div>
          <div class="zt-watch-related__list">
            <NuxtLink
              v-for="(video, index) in relatedVideos"
              :key="video.videoId"
              :to="watchLocation(video.videoId)"
              class="flex min-h-24 gap-3 border-b border-gray-100 p-3 transition hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#065fd4]"
              :class="{ 'bg-[#e8f0fe]': video.videoId === videoId }"
              :aria-current="video.videoId === videoId ? 'true' : undefined"
            >
              <span class="w-5 shrink-0 text-center text-sm text-[#606060]">{{ Number(index) + 1 }}</span>
              <div class="relative shrink-0">
                <img :src="video.videoThumbnail" :alt="video.videoTitle" class="h-16 w-28 rounded-lg object-cover lg:h-14 lg:w-24" />
                <span v-if="video.duration" class="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 text-xs text-white">
                  {{ formatDuration(video.duration) }}
                </span>
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm line-clamp-2">{{ video.videoTitle }}</p>
                <p class="mt-1 truncate text-xs text-[#606060]">{{ video.channelTitle }}</p>
              </div>
            </NuxtLink>
          </div>
        </aside>
      </div>
    </div>
  </div>
</template>
