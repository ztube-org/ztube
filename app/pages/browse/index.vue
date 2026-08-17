<script setup lang="ts">
import { apiFetch, useApi } from '../../../src/api'
import { contentStatus } from '../../../src/content-rule-ui'

const { data } = useApi<any>('/api/child/browse')

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
    <div class="mb-7 flex items-end justify-between gap-4">
      <div>
        <p class="mb-1 text-sm font-medium text-[#065fd4]">Your approved library</p>
        <h1 class="text-3xl font-bold tracking-tight">Watch</h1>
      </div>
    </div>

    <section v-if="data?.recommendations?.length" class="mb-10 rounded-2xl bg-blue-50 p-4 ring-1 ring-blue-200">
      <div class="mb-3 flex items-center gap-2">
        <UIcon name="i-heroicons-megaphone" class="h-6 w-6 text-[#065fd4]" />
        <h2 class="text-xl font-bold">New for You</h2>
        <UBadge color="primary" variant="solid">{{ data.recommendationCount }} new</UBadge>
      </div>
      <div class="zt-video-grid">
        <NuxtLink v-for="video in data.recommendations" :key="video.videoId" :to="`/watch?v=${video.videoId}`" class="zt-video-card group">
          <div class="relative">
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
      <div class="zt-video-grid">
        <NuxtLink v-for="video in data.continueWatching" :key="video.videoId" :to="`/watch?v=${video.videoId}`" class="zt-video-card group">
          <div class="relative">
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
      <div class="zt-video-grid">
        <NuxtLink v-for="video in data.favorites" :key="video.videoId" :to="`/watch?v=${video.videoId}`" class="zt-video-card group">
          <div class="relative">
            <img :src="video.videoThumbnail" :alt="video.videoTitle" class="zt-thumbnail" />
            <span v-if="video.duration" class="zt-duration">{{ formatDuration(video.duration) }}</span>
            <UButton icon="i-heroicons-star-solid" color="neutral" variant="solid" size="xs" class="absolute right-2 top-2 min-h-11 min-w-11" aria-label="Remove from Favorites" @click.prevent.stop="toggleFavorite(video)" />
          </div>
          <p class="mt-3 font-semibold leading-5 line-clamp-2">{{ video.videoTitle }}</p>
          <p class="mt-1 truncate text-sm text-[#606060]">{{ video.channelTitle }}</p>
        </NuxtLink>
      </div>
    </section>

    <!-- Channels Section -->
    <section v-if="data?.channels?.length" class="mb-10 border-b border-gray-200 pb-8">
      <h2 class="zt-section-title">Channels</h2>
      <div class="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
        <NuxtLink
          v-for="channel in data.channels"
          :key="channel.id"
          :to="`/browse/channel/${channel.id}`"
          class="group"
          :class="{ 'pointer-events-none opacity-50': bucketFor(channel)?.locked, 'opacity-75': !channel.isAvailable && !bucketFor(channel)?.locked }"
        >
          <div class="flex flex-col items-center text-center">
            <UAvatar
              :src="channel.channelThumbnail"
              :alt="channel.channelTitle"
              size="xl"
              class="mb-2 transition group-hover:ring-2 group-hover:ring-[#065fd4]"
            />
            <p class="text-sm font-medium truncate w-full">{{ channel.channelTitle }}</p>
            <p v-if="!channel.isAvailable" class="text-xs text-amber-600">Tap to reload videos</p>
            <p v-else-if="bucketFor(channel)?.locked" class="text-xs text-amber-600">{{ channel.contentRule === 'exempt' ? 'Safety Cap used' : 'Daily Allowance used' }}</p>
            <p v-else-if="ruleLabel(channel)" class="text-xs text-green-600">{{ ruleLabel(channel) }}</p>
          </div>
        </NuxtLink>
      </div>
    </section>

    <!-- Playlists Section -->
    <section v-if="data?.playlists?.length" class="mb-10">
      <h2 class="zt-section-title">Playlists</h2>
      <div class="zt-video-grid">
        <NuxtLink
          v-for="playlist in data.playlists"
          :key="playlist.id"
          :to="`/browse/playlist/${playlist.id}`"
          class="zt-video-card group"
          :class="{ 'pointer-events-none opacity-50': bucketFor(playlist)?.locked, 'opacity-75': !playlist.isAvailable && !bucketFor(playlist)?.locked }"
        >
          <div class="relative">
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
          <p v-else-if="bucketFor(playlist)?.locked" class="text-xs text-amber-600">{{ playlist.contentRule === 'exempt' ? 'Safety Cap used' : 'Daily Allowance used' }}</p>
          <p v-else-if="ruleLabel(playlist)" class="text-xs text-green-600">{{ ruleLabel(playlist) }}</p>
        </NuxtLink>
      </div>
    </section>

    <!-- Videos Section -->
    <section v-if="data?.videos?.length" class="mb-10">
      <h2 class="zt-section-title">Videos</h2>
      <div class="zt-video-grid">
        <NuxtLink
          v-for="video in data.videos"
          :key="video.id"
          :to="`/watch?v=${video.videoId}`"
          class="zt-video-card group"
          :class="{ 'opacity-50 pointer-events-none': !video.isAvailable || bucketFor(video)?.locked }"
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
              @click.prevent.stop="toggleFavorite(video)"
            />
          </div>
          <p class="mt-3 font-semibold leading-5 line-clamp-2">{{ video.videoTitle }}</p>
          <p class="mt-1 truncate text-sm text-[#606060]">{{ video.channelTitle }}</p>
          <p v-if="video.publishedAt" class="mt-1 text-sm text-[#606060]">{{ formatPublishedDate(video.publishedAt) }}</p>
          <p v-if="!video.isAvailable" class="text-xs text-red-500">Unavailable</p>
          <p v-else-if="bucketFor(video)?.locked" class="text-xs text-amber-600">{{ video.contentRule === 'exempt' ? 'Safety Cap used' : 'Daily Allowance used' }}</p>
          <p v-else-if="ruleLabel(video)" class="text-xs text-green-600">{{ ruleLabel(video) }}</p>
        </NuxtLink>
      </div>
    </section>

    <!-- Empty State -->
    <div v-if="!data?.channels?.length && !data?.playlists?.length && !data?.videos?.length" class="text-center py-16">
      <UIcon name="i-heroicons-video-camera" class="w-16 h-16 mx-auto text-gray-400 mb-4" />
      <p class="text-gray-500 text-lg">No content yet!</p>
      <p class="text-gray-400">Ask your parent to add some channels, playlists, or videos.</p>
    </div>
  </div>
</template>
