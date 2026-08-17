<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { apiFetch } from '../../../../src/api'

const route = useRoute()
const playlistId = route.params.id as string

const data = ref<any>(null)
const loadError = ref('')
const page = ref(0)
const refreshing = ref(false)
const refreshError = ref('')
const loadingMore = ref(false)

async function refreshLatest() {
  page.value = 0
  refreshing.value = true
  refreshError.value = ''
  try {
    data.value = await apiFetch<any>(`/api/child/playlist/${playlistId}/videos?refresh=true`)
  } catch (value) {
    refreshError.value = value instanceof Error ? value.message : 'Unable to refresh playlist videos'
  } finally {
    refreshing.value = false
  }
}

onMounted(async () => {
  try {
    data.value = await apiFetch<any>(`/api/child/playlist/${playlistId}/videos`)
    await nextTick()
  } catch (value) {
    loadError.value = value instanceof Error ? value.message : 'Unable to load cached playlist videos'
  }
  await refreshLatest()
})

async function loadMore() {
  if (!data.value?.nextPageToken) return
  loadingMore.value = true
  try {
    const nextPage = page.value + 1
    const result = await apiFetch<any>(`/api/child/playlist/${playlistId}/videos?page=${nextPage}&pageToken=${encodeURIComponent(data.value.nextPageToken)}`)
    data.value.videos.push(...result.videos)
    data.value.favoriteVideoIds = [...new Set([...(data.value.favoriteVideoIds ?? []), ...(result.favoriteVideoIds ?? [])])]
    data.value.nextPageToken = result.nextPageToken
    page.value = nextPage
  } finally {
    loadingMore.value = false
  }
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
      <UButton color="neutral" variant="soft" icon="i-heroicons-arrow-path" :loading="refreshing" @click="refreshLatest">Refresh</UButton>
    </div>

    <UAlert v-if="loadError || refreshError" color="red" title="Unable to refresh playlist videos" :description="refreshError || loadError" class="mb-4" />

    <div v-else-if="!data?.videos?.length" class="py-12 text-center text-gray-500">
      Loading playlist videos…
    </div>

    <div v-else class="zt-video-grid">
      <NuxtLink
        v-for="video in data.videos"
        :key="video.id"
        :to="`/watch?v=${video.videoId}&playlist=${playlistId}`"
        class="zt-video-card group"
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
      </NuxtLink>
    </div>

    <div v-if="data?.nextPageToken" class="mt-5 flex justify-center">
      <UButton variant="soft" :loading="loadingMore" @click="loadMore">Load more videos</UButton>
    </div>
  </div>
</template>
