<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { apiFetch, useApi, useAuth } from '../../src/api'
import { authorizeAndCreatePlayer, createPlaybackReporter, createYouTubePlayer, type PlaybackState, type YouTubePlayer } from '../../src/youtube-player'

const route = useRoute()
const videoId = route.query.v as string
const playlistParam = route.query.playlist as string | undefined

const { logout } = useAuth()

// Fetch playlist videos if playlist param present
const playlistData = playlistParam
  ? useApi<any>(`/api/child/playlist/${playlistParam}/videos`)
  : { data: ref(null) }

const currentVideoIndex = computed(() => {
  if (!playlistData.data.value?.videos) return -1
  return playlistData.data.value.videos.findIndex((v: any) => v.videoId === videoId)
})

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// YouTube iframe API for playback speed
const player = ref<YouTubePlayer | null>(null)
const playbackError = ref<string | null>(null)
const remainingSeconds = ref<number | null>(null)
const usageBucket = ref<'restricted' | 'exempt'>('restricted')
const favorite = ref(false)
let reporter: ReturnType<typeof createPlaybackReporter> | null = null

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
    let authorization!: { sessionId: string; remainingSeconds: number; usageBucket: 'restricted' | 'exempt'; resumeAt: number; favorite: boolean }
    player.value = await authorizeAndCreatePlayer(
      videoId,
      async requestedVideoId => {
        const response = await apiFetch<{ authorization: { sessionId: string; remainingSeconds: number; usageBucket: 'restricted' | 'exempt'; resumeAt: number; favorite: boolean } }>('/api/child/playback-authorizations', { method: 'POST', body: { videoId: requestedVideoId } })
        authorization = response.authorization
        usageBucket.value = authorization.usageBucket
        favorite.value = authorization.favorite
      },
      () => createYouTubePlayer('youtube-player', {
        videoId,
        onReady: readyPlayer => {
          if (authorization.resumeAt >= 30) readyPlayer.seekTo?.(authorization.resumeAt, true)
        },
        onStateChange: (state: PlaybackState) => reporter?.setState(state),
      }),
    )
    reporter = createPlaybackReporter({
      initialRemainingSeconds: authorization.remainingSeconds,
      heartbeat: (sequence, state, positionSeconds) => apiFetch(`/api/child/playback-authorizations/${authorization.sessionId}/heartbeats`, { method: 'POST', body: { sequence, state, positionSeconds } }),
      pause: () => player.value?.pauseVideo?.(),
      position: () => player.value?.getCurrentTime?.() ?? 0,
      onRemaining: seconds => { remainingSeconds.value = seconds },
    })
  } catch (error) {
    playbackError.value = error instanceof Error ? error.message : 'Playback could not be authorized'
  }
})

onBeforeUnmount(() => reporter?.stop())

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
    <!-- Header -->
    <header class="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-gray-200 bg-white/95 px-4 backdrop-blur sm:px-6">
      <NuxtLink :to="playlistParam ? `/browse/playlist/${playlistParam}` : '/browse'" class="flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-medium hover:bg-gray-100">
        <UIcon name="i-heroicons-arrow-left" class="w-5 h-5" />
        Back
      </NuxtLink>
      <span class="flex items-center gap-2 text-xl font-bold"><span class="flex h-8 w-10 items-center justify-center rounded-lg bg-[#065fd4] text-white"><UIcon name="i-heroicons-play-solid" class="h-4 w-4" /></span>ZTube</span>
      <UButton color="neutral" variant="ghost" size="sm" @click="logout">
        Logout
      </UButton>
    </header>

    <div class="mx-auto flex max-w-[1600px] flex-col gap-6 p-0 sm:p-4 lg:p-6 xl:flex-row xl:items-start">
      <!-- Main Player Area -->
      <div class="min-w-0 flex-1">
        <!-- Video Player -->
        <div class="aspect-video overflow-hidden bg-black sm:rounded-xl">
          <div v-if="!playbackError" id="youtube-player" class="w-full h-full"></div>
          <div v-else class="flex h-full items-center justify-center p-6 text-center text-blue-200">
            {{ playbackError }}
          </div>
        </div>

        <!-- Controls -->
        <div class="border-b border-gray-200 bg-white p-4 sm:mt-3 sm:rounded-xl sm:border">
          <div class="flex items-center justify-between gap-4">
            <div>
              <p v-if="usageBucket === 'exempt'" class="text-sm font-medium text-[#065fd4]">Safety Cap only</p>
            <p v-if="remainingSeconds !== null" class="text-lg font-semibold">{{ formatRemaining(remainingSeconds) }} {{ usageBucket === 'exempt' ? 'Safety Cap' : 'Daily Allowance' }} remaining</p>
              <p v-if="warning" class="text-sm font-medium text-amber-600" role="alert">{{ warning }}</p>
            </div>
            <UButton :icon="favorite ? 'i-heroicons-star-solid' : 'i-heroicons-star'" :variant="favorite ? 'solid' : 'soft'" @click="toggleFavorite">
              {{ favorite ? 'Favorited' : 'Favorite' }}
            </UButton>
          </div>
        </div>
      </div>

      <!-- Playlist Sidebar -->
      <aside v-if="playlistData.data.value?.videos" class="zt-panel w-full overflow-hidden xl:sticky xl:top-22 xl:max-h-[calc(100vh-7rem)] xl:w-[400px] xl:overflow-y-auto">
        <div class="border-b border-gray-200 p-4">
          <h3 class="font-semibold truncate">{{ playlistData.data.value.playlist?.title }}</h3>
          <p class="text-sm text-[#606060]">{{ playlistData.data.value.videos.length }} videos</p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:block">
          <NuxtLink
            v-for="(video, index) in playlistData.data.value.videos"
            :key="video.id"
            :to="`/watch?v=${video.videoId}&playlist=${playlistParam}`"
            class="flex min-h-24 gap-3 border-b border-gray-100 p-3 transition hover:bg-gray-100"
            :class="{ 'bg-[#e8f0fe]': video.videoId === videoId }"
          >
            <span class="w-5 shrink-0 text-center text-sm text-[#606060]">{{ Number(index) + 1 }}</span>
            <div class="relative flex-shrink-0">
              <img :src="video.videoThumbnail" class="h-16 w-28 rounded-lg object-cover xl:h-14 xl:w-24" />
              <span v-if="video.duration" class="absolute bottom-0.5 right-0.5 bg-black/80 text-xs px-1 rounded">
                {{ formatDuration(video.duration) }}
              </span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm line-clamp-2">{{ video.videoTitle }}</p>
              <p class="mt-1 truncate text-xs text-[#606060]">{{ video.channelTitle }}</p>
            </div>
          </NuxtLink>
        </div>
      </aside>
    </div>
  </div>
</template>
