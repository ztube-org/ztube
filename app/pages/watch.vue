<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { apiFetch, useApi, useAuth } from '../../src/api'
import { authorizeAndCreatePlayer, createYouTubePlayer, type YouTubePlayer } from '../../src/youtube-player'

const route = useRoute()
const videoId = route.query.v as string
const playlistParam = route.query.playlist as string | undefined

const { logout } = useAuth()

// Fetch playlist videos if playlist param present
const playlistData = playlistParam
  ? useApi<any>(`/api/child/playlist/${playlistParam}/videos`)
  : { data: ref(null) }

const playbackSpeed = ref(1)
const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2]

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

onMounted(async () => {
  try {
    player.value = await authorizeAndCreatePlayer(
      videoId,
      async requestedVideoId => { await apiFetch('/api/child/playback-authorizations', { method: 'POST', body: { videoId: requestedVideoId } }) },
      () => createYouTubePlayer('youtube-player', {
        videoId,
        onReady: readyPlayer => readyPlayer.setPlaybackRate(playbackSpeed.value),
      }),
    )
  } catch (error) {
    playbackError.value = error instanceof Error ? error.message : 'Playback could not be authorized'
  }
})

watch(playbackSpeed, (speed) => {
  if (player.value?.setPlaybackRate) {
    player.value.setPlaybackRate(speed)
  }
})
</script>

<template>
  <div class="min-h-screen bg-gray-900 text-white">
    <!-- Header -->
    <header class="bg-gray-800 px-4 py-3 flex items-center justify-between">
      <NuxtLink :to="playlistParam ? `/browse/playlist/${playlistParam}` : '/browse'" class="flex items-center gap-2 text-gray-300 hover:text-white">
        <UIcon name="i-heroicons-arrow-left" class="w-5 h-5" />
        Back
      </NuxtLink>
      <span class="text-xl font-bold text-primary-500">ZTube</span>
      <UButton color="gray" variant="ghost" size="sm" @click="logout">
        Logout
      </UButton>
    </header>

    <div class="flex">
      <!-- Main Player Area -->
      <div :class="playlistData.data.value ? 'flex-1' : 'w-full'">
        <!-- Video Player -->
        <div class="aspect-video bg-black">
          <div v-if="!playbackError" id="youtube-player" class="w-full h-full"></div>
          <div v-else class="h-full flex items-center justify-center p-6 text-center text-red-300">
            {{ playbackError }}
          </div>
        </div>

        <!-- Controls -->
        <div class="p-4 bg-gray-800">
          <div class="flex items-center gap-4">
            <span class="text-sm text-gray-400">Speed:</span>
            <div class="flex gap-1">
              <UButton
                v-for="speed in speeds"
                :key="speed"
                :variant="playbackSpeed === speed ? 'solid' : 'ghost'"
                :color="playbackSpeed === speed ? 'primary' : 'gray'"
                size="xs"
                @click="playbackSpeed = speed"
              >
                {{ speed }}x
              </UButton>
            </div>
          </div>
        </div>
      </div>

      <!-- Playlist Sidebar -->
      <div v-if="playlistData.data.value?.videos" class="w-80 bg-gray-800 overflow-y-auto h-[calc(100vh-56px)]">
        <div class="p-4 border-b border-gray-700">
          <h3 class="font-semibold truncate">{{ playlistData.data.value.playlist?.title }}</h3>
          <p class="text-sm text-gray-400">{{ playlistData.data.value.videos.length }} videos</p>
        </div>
        <div class="divide-y divide-gray-700">
          <NuxtLink
            v-for="(video, index) in playlistData.data.value.videos"
            :key="video.id"
            :to="`/watch?v=${video.videoId}&playlist=${playlistParam}`"
            class="flex gap-3 p-3 hover:bg-gray-700 transition"
            :class="{ 'bg-gray-700': video.videoId === videoId }"
          >
            <span class="text-sm text-gray-400 w-6 text-center">{{ Number(index) + 1 }}</span>
            <div class="relative flex-shrink-0">
              <img :src="video.videoThumbnail" class="w-24 h-14 object-cover rounded" />
              <span v-if="video.duration" class="absolute bottom-0.5 right-0.5 bg-black/80 text-xs px-1 rounded">
                {{ formatDuration(video.duration) }}
              </span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm line-clamp-2">{{ video.videoTitle }}</p>
              <p class="text-xs text-gray-400 truncate mt-1">{{ video.channelTitle }}</p>
            </div>
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
