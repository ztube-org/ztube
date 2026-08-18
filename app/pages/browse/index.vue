<script setup lang="ts">
import { computed, ref } from 'vue'
import { apiFetch, useApi } from '../../../src/api'
import { contentStatus } from '../../../src/content-rule-ui'

const { data } = useApi<any>('/api/child/browse')
const contentSearch = ref('')
const selectedTag = ref('')
const allTags = computed(() => [...new Set([
  ...(data.value?.channels ?? []), ...(data.value?.playlists ?? []), ...(data.value?.videos ?? []),
].flatMap((item: any) => item.tags ?? []))].sort())
function matches(item: any, title: string) {
  const query = contentSearch.value.trim().toLowerCase()
  return (!query || `${title} ${(item.tags ?? []).join(' ')}`.toLowerCase().includes(query))
    && (!selectedTag.value || item.tags?.includes(selectedTag.value))
}
const filteredChannels = computed(() => (data.value?.channels ?? []).filter((item: any) => matches(item, item.channelTitle)))
const filteredPlaylists = computed(() => (data.value?.playlists ?? []).filter((item: any) => matches(item, item.playlistTitle)))
const filteredVideos = computed(() => (data.value?.videos ?? []).filter((item: any) => matches(item, `${item.videoTitle} ${item.channelTitle ?? ''}`)))

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatPublishedDate(value: string | null): string {
  return value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(value)) : ''
}

function bucketFor(item: any) {
  return data.value?.watchTime ? contentStatus(item.contentRule, data.value.watchTime) : null
}

function ruleLabel(item: any) {
  if (item.contentRule !== 'exempt') return null
  return data.value?.watchTime ? contentStatus(item.contentRule, data.value.watchTime).label : null
}

function progressPercent(video: any) {
  return Math.min(100, Math.round(video.positionSeconds / video.duration * 100))
}

async function toggleFavorite(video: any) {
  const favorites: string[] = data.value.favoriteVideoIds ?? []
  if (favorites.includes(video.videoId)) {
    if (!confirm(`Remove “${video.videoTitle}” from Favorites?`)) return
    await apiFetch(`/api/child/favorites/${encodeURIComponent(video.videoId)}`, { method: 'DELETE' })
    data.value.favoriteVideoIds = favorites.filter(id => id !== video.videoId)
    data.value.favorites = data.value.favorites.filter((item: any) => item.videoId !== video.videoId)
  } else {
    await apiFetch('/api/child/favorites', { method: 'POST', body: { videoId: video.videoId } })
    data.value.favoriteVideoIds = [...favorites, video.videoId]
    data.value.favorites = [...data.value.favorites, video]
  }
}
</script>

<template>
  <div class="zt-page">
    <UAlert v-if="data?.policy?.blocked" color="warning" title="You can browse now, but playback is unavailable" class="mb-4" />
    <div class="mb-5 flex flex-wrap gap-2">
      <UInput v-model="contentSearch" icon="i-heroicons-magnifying-glass" placeholder="Search channels, playlists, videos, or tags" class="min-w-64 flex-1" />
      <UButton :variant="selectedTag ? 'soft' : 'solid'" color="neutral" @click="selectedTag = ''">All</UButton>
      <UButton v-for="tag in allTags" :key="tag" :variant="selectedTag === tag ? 'solid' : 'soft'" color="neutral" @click="selectedTag = tag">{{ tag }}</UButton>
    </div>
    <section v-if="data?.recommendations?.length" class="mb-10 rounded-2xl bg-blue-50 p-4 ring-1 ring-blue-200">
      <div class="mb-3 flex items-center gap-2">
        <UIcon name="i-heroicons-megaphone" class="h-6 w-6 text-[#065fd4]" />
        <h2 class="text-xl font-bold">New for You</h2>
        <UBadge color="primary" variant="solid">{{ data.recommendationCount }} new</UBadge>
      </div>
      <div class="zt-video-grid">
        <NuxtLink v-for="video in data.recommendations" :key="video.videoId" :to="`/watch?v=${video.videoId}`" class="zt-video-card group">
          <div class="zt-video-card__media">
            <img :src="video.videoThumbnail" :alt="video.videoTitle" class="zt-thumbnail" />
            <span v-if="video.duration" class="zt-duration">{{ formatDuration(video.duration) }}</span>
            <UBadge color="primary" variant="solid" class="absolute left-2 top-2">NEW</UBadge>
          </div>
          <p class="mt-3 font-semibold leading-5 line-clamp-2">{{ video.videoTitle }}</p>
          <p class="mt-1 truncate text-sm text-[#606060]">{{ video.channelTitle }}</p>
        </NuxtLink>
      </div>
    </section>

    <section v-if="data?.continueWatching?.length" class="mb-10">
      <h2 class="zt-section-title">Continue Watching</h2>
      <div class="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3">
        <NuxtLink v-for="video in data.continueWatching" :key="video.videoId" :to="`/watch?v=${video.videoId}`" class="zt-video-card group w-48 shrink-0 snap-start sm:w-52">
          <div class="zt-video-card__media">
            <img :src="video.videoThumbnail" :alt="video.videoTitle" class="zt-thumbnail" />
            <span class="zt-duration">{{ formatDuration(video.positionSeconds) }} / {{ formatDuration(video.duration) }}</span>
            <div class="absolute inset-x-0 bottom-0 h-1 bg-gray-300"><div class="h-full bg-[#065fd4]" :style="{ width: `${progressPercent(video)}%` }" /></div>
          </div>
          <p class="mt-3 font-semibold leading-5 line-clamp-2">{{ video.videoTitle }}</p>
          <p class="mt-1 truncate text-sm text-[#606060]">{{ video.channelTitle }}</p>
        </NuxtLink>
      </div>
    </section>

    <section v-if="data?.favorites?.length" class="mb-10">
      <h2 class="zt-section-title">Favorites</h2>
      <div class="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3">
        <NuxtLink v-for="video in data.favorites" :key="video.videoId" :to="`/watch?v=${video.videoId}`" class="zt-video-card group w-48 shrink-0 snap-start sm:w-52">
          <div class="zt-video-card__media">
            <img :src="video.videoThumbnail" :alt="video.videoTitle" class="zt-thumbnail" />
            <span v-if="video.duration" class="zt-duration">{{ formatDuration(video.duration) }}</span>
            <UButton icon="i-heroicons-star-solid" color="neutral" variant="solid" size="xs" class="zt-video-card__favorite" aria-label="Remove from Favorites" @click.prevent.stop="toggleFavorite(video)" />
          </div>
          <p class="mt-3 font-semibold leading-5 line-clamp-2">{{ video.videoTitle }}</p>
          <p class="mt-1 truncate text-sm text-[#606060]">{{ video.channelTitle }}</p>
        </NuxtLink>
      </div>
    </section>

    <!-- Channels Section -->
    <section v-if="filteredChannels.length" class="mb-10 border-b border-gray-200 pb-8">
      <h2 class="zt-section-title">Channels</h2>
      <div class="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
        <NuxtLink
          v-for="channel in filteredChannels"
          :key="channel.id"
          :to="`/browse/channel/${channel.id}`"
          class="group"
          :class="{ 'opacity-75': !channel.isAvailable }"
        >
          <div class="flex flex-col items-center text-center">
            <UAvatar
              :src="channel.channelThumbnail"
              :alt="channel.channelTitle"
              size="xl"
              class="zt-source-artwork mb-2 transition group-hover:ring-2 group-hover:ring-[#065fd4]"
            />
            <p class="text-sm font-medium truncate w-full">{{ channel.channelTitle }}</p>
            <p v-if="!channel.isAvailable" class="text-xs text-amber-600">Tap to reload videos</p>
            <p v-else-if="bucketFor(channel)?.locked" class="text-xs text-amber-600">Some videos may still be available</p>
            <p v-else-if="ruleLabel(channel)" class="text-xs text-green-600">{{ ruleLabel(channel) }}</p>
            <div v-if="channel.tags?.length" class="mt-1 flex flex-wrap justify-center gap-1"><UBadge v-for="tag in channel.tags" :key="tag" color="neutral" variant="soft">{{ tag }}</UBadge></div>
          </div>
        </NuxtLink>
      </div>
    </section>

    <!-- Playlists Section -->
    <section v-if="filteredPlaylists.length" class="mb-10">
      <h2 class="zt-section-title">Playlists</h2>
      <div class="zt-video-grid">
        <NuxtLink
          v-for="playlist in filteredPlaylists"
          :key="playlist.id"
          :to="`/browse/playlist/${playlist.id}`"
          class="zt-video-card group"
          :class="{ 'opacity-75': !playlist.isAvailable }"
        >
          <div class="zt-video-card__media">
            <img
              :src="playlist.playlistThumbnail"
              :alt="playlist.playlistTitle"
              class="zt-thumbnail"
            />
            <div class="zt-duration">
              Playlist
            </div>
          </div>
          <p class="mt-3 font-semibold leading-5 line-clamp-2">{{ playlist.playlistTitle }}</p>
          <p v-if="!playlist.isAvailable" class="text-xs text-amber-600">Tap to reload videos</p>
          <p v-else-if="bucketFor(playlist)?.locked" class="text-xs text-amber-600">Some videos may still be available</p>
          <p v-else-if="ruleLabel(playlist)" class="text-xs text-green-600">{{ ruleLabel(playlist) }}</p>
          <div v-if="playlist.tags?.length" class="mt-1 flex flex-wrap gap-1"><UBadge v-for="tag in playlist.tags" :key="tag" color="neutral" variant="soft">{{ tag }}</UBadge></div>
        </NuxtLink>
      </div>
    </section>

    <!-- Videos Section -->
    <section v-if="filteredVideos.length" class="mb-10">
      <h2 class="zt-section-title">Videos</h2>
      <div class="zt-video-grid">
        <NuxtLink
          v-for="video in filteredVideos"
          :key="video.videoId"
          :to="`/watch?v=${video.videoId}`"
          class="zt-video-card group"
          :class="{ 'opacity-50 pointer-events-none': !video.isAvailable || bucketFor(video)?.locked || data?.policy?.blocked }"
        >
          <div class="zt-video-card__media">
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
              class="zt-video-card__favorite"
              :aria-label="data.favoriteVideoIds?.includes(video.videoId) ? 'Remove from Favorites' : 'Add to Favorites'"
              @click.prevent.stop="toggleFavorite(video)"
            />
          </div>
          <p class="mt-3 font-semibold leading-5 line-clamp-2">{{ video.videoTitle }}</p>
          <p class="mt-1 truncate text-sm text-[#606060]">{{ video.channelTitle }}</p>
          <p v-if="video.publishedAt" class="mt-1 text-sm text-[#606060]">{{ formatPublishedDate(video.publishedAt) }}</p>
          <p v-if="!video.isAvailable" class="text-xs text-red-500">Unavailable</p>
          <p v-else-if="bucketFor(video)?.locked" class="text-xs text-amber-600">{{ video.contentRule === 'exempt' ? 'Safety Cap used' : 'Daily Allowance used' }}</p>
          <p v-else-if="ruleLabel(video)" class="text-xs text-green-600">{{ ruleLabel(video) }}</p>
          <div v-if="video.tags?.length" class="mt-1 flex flex-wrap gap-1"><UBadge v-for="tag in video.tags" :key="tag" color="neutral" variant="soft">{{ tag }}</UBadge></div>
        </NuxtLink>
      </div>
    </section>

    <!-- Empty State -->
    <div v-if="!data?.channels?.length && !data?.playlists?.length && !data?.videos?.length" class="text-center py-16">
      <UIcon name="i-heroicons-video-camera" class="w-16 h-16 mx-auto text-gray-400 mb-4" />
      <p class="text-gray-500 text-lg">No content yet!</p>
      <p class="text-gray-400">Ask an Admin to add some channels, playlists, or videos.</p>
    </div>
  </div>
</template>
