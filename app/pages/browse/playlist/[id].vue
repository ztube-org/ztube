<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { apiFetch } from '../../../../src/api'
import { contentStatus } from '../../../../src/content-rule-ui'

const route = useRoute()
const playlistId = route.params.id as string

const data = ref<any>(null)
const loadError = ref('')
const loadingMore = ref(false)
const search = ref('')
const filteredVideos = computed(() => {
  const query = search.value.trim().toLowerCase()
  return (data.value?.videos ?? []).filter((video: any) => !query || `${video.videoTitle} ${video.channelTitle ?? ''}`.toLowerCase().includes(query))
})
function blocked(video: any) {
  return Boolean(data.value?.policy?.blocked || (data.value?.watchTime && contentStatus(video.contentRule, data.value.watchTime).locked))
}

onMounted(async () => {
  try {
    data.value = await apiFetch<any>(`/api/child/playlist/${playlistId}/videos`)
  } catch (value) {
    loadError.value = value instanceof Error ? value.message : 'Unable to load cached playlist videos'
  }
})

async function loadMore() {
  if (data.value?.nextPage === null) return
  loadingMore.value = true
  try {
    const result = await apiFetch<any>(`/api/child/playlist/${playlistId}/videos?page=${data.value.nextPage}`)
    data.value.videos.push(...result.videos)
    data.value.favoriteVideoIds = [...new Set([...(data.value.favoriteVideoIds ?? []), ...(result.favoriteVideoIds ?? [])])]
    data.value.nextPage = result.nextPage
  } finally { loadingMore.value = false }
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatPublishedDate(value: string | null): string {
  return value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(value)) : ''
}

async function toggleFavorite(videoId: string) {
  const favorites: string[] = data.value.favoriteVideoIds ?? []
  if (favorites.includes(videoId)) {
    await apiFetch(`/api/child/favorites/${encodeURIComponent(videoId)}`, { method: 'DELETE' })
    data.value.favoriteVideoIds = favorites.filter(id => id !== videoId)
  } else {
    await apiFetch('/api/child/favorites', { method: 'POST', body: { videoId } })
    data.value.favoriteVideoIds = [...favorites, videoId]
  }
}
</script>

<template>
  <div class="zt-page">
    <div class="mb-8 flex items-center gap-4 border-b border-gray-200 pb-6">
      <NuxtLink to="/browse">
        <UButton color="gray" variant="ghost" icon="i-heroicons-arrow-left" />
      </NuxtLink>
      <img
        v-if="data?.playlist?.thumbnail"
        :src="data.playlist.thumbnail"
        class="h-16 w-28 rounded-lg object-cover"
      />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium text-[#065fd4]">Playlist</p>
        <h1 class="truncate text-2xl font-bold tracking-tight">{{ data?.playlist?.title }}</h1>
      </div>
      <span class="text-xs text-gray-500">Updated automatically</span>
    </div>

    <UAlert v-if="loadError" color="red" title="Unable to load playlist videos" :description="loadError" class="mb-4" />
    <UAlert v-else-if="data?.policy?.blocked" color="warning" title="Videos are visible, but playback is unavailable right now" class="mb-4" />
    <UInput v-if="data?.videos?.length" v-model="search" icon="i-heroicons-magnifying-glass" placeholder="Search videos" class="mb-4 w-full" />

    <div v-else-if="!data?.videos?.length" class="py-12 text-center text-gray-500">
      No videos have synced yet. Ask the Admin to sync this playlist.
    </div>

    <div v-else class="zt-video-grid">
      <NuxtLink
        v-for="video in filteredVideos"
        :key="video.videoId"
        :to="`/watch?v=${video.videoId}&playlist=${playlistId}`"
        class="zt-video-card group"
        :class="{ 'pointer-events-none opacity-50': blocked(video) }"
      >
        <div class="relative">
          <img
            :src="video.videoThumbnail"
            :alt="video.videoTitle"
            class="zt-thumbnail"
          />
          <span v-if="video.duration" class="zt-duration">
            {{ formatDuration(video.duration) }}
          </span>
          <UButton
            :icon="data.favoriteVideoIds?.includes(video.videoId) ? 'i-heroicons-star-solid' : 'i-heroicons-star'"
            color="neutral"
            variant="solid"
            size="xs"
            class="absolute right-2 top-2 min-h-11 min-w-11"
            :aria-label="data.favoriteVideoIds?.includes(video.videoId) ? 'Remove from Favorites' : 'Add to Favorites'"
            @click.prevent.stop="toggleFavorite(video.videoId)"
          />
        </div>
        <p class="mt-3 font-semibold leading-5 line-clamp-2">{{ video.videoTitle }}</p>
        <p class="mt-1 truncate text-sm text-[#606060]">{{ video.channelTitle }}</p>
        <p v-if="video.publishedAt" class="mt-1 text-sm text-[#606060]">{{ formatPublishedDate(video.publishedAt) }}</p>
        <p v-if="blocked(video)" class="text-xs text-amber-600">Playback unavailable right now</p>
      </NuxtLink>
    </div>
    <div v-if="data && data.nextPage !== null" class="mt-5 flex justify-center"><UButton variant="soft" :loading="loadingMore" @click="loadMore">Load more videos</UButton></div>
  </div>
</template>
