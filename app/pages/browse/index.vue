<script setup lang="ts">
import { useApi } from '../../../src/api'
import { contentStatus } from '../../../src/content-rule-ui'

const { data } = useApi<any>('/api/child/browse')

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function bucketFor(item: any) {
  return data.value?.watchTime ? contentStatus(item.contentRule, data.value.watchTime) : null
}

function ruleLabel(item: any) {
  if (item.contentRule !== 'exempt') return null
  return data.value?.watchTime ? contentStatus(item.contentRule, data.value.watchTime).label : null
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

    <!-- Channels Section -->
    <section v-if="data?.channels?.length" class="mb-10 border-b border-gray-200 pb-8">
      <h2 class="zt-section-title">Channels</h2>
      <div class="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
        <NuxtLink
          v-for="channel in data.channels"
          :key="channel.id"
          :to="`/browse/channel/${channel.id}`"
          class="group"
          :class="{ 'opacity-50 pointer-events-none': !channel.isAvailable || bucketFor(channel)?.locked }"
        >
          <div class="flex flex-col items-center text-center">
            <UAvatar
              :src="channel.channelThumbnail"
              :alt="channel.channelTitle"
              size="xl"
              class="mb-2 transition group-hover:ring-2 group-hover:ring-[#065fd4]"
            />
            <p class="text-sm font-medium truncate w-full">{{ channel.channelTitle }}</p>
            <p v-if="!channel.isAvailable" class="text-xs text-red-500">Unavailable</p>
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
          :class="{ 'opacity-50 pointer-events-none': !playlist.isAvailable || bucketFor(playlist)?.locked }"
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
          <p v-if="!playlist.isAvailable" class="text-xs text-red-500">Unavailable</p>
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
          </div>
          <p class="mt-3 font-semibold leading-5 line-clamp-2">{{ video.videoTitle }}</p>
          <p class="mt-1 truncate text-sm text-[#606060]">{{ video.channelTitle }}</p>
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
