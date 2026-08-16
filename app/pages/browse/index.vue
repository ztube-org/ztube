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
  <div>
    <h1 class="text-2xl font-bold mb-8">My Videos</h1>

    <!-- Channels Section -->
    <section v-if="data?.channels?.length" class="mb-12">
      <h2 class="text-lg font-semibold mb-4">Channels</h2>
      <div class="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
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
              class="mb-2 group-hover:ring-2 ring-primary-500 transition"
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
    <section v-if="data?.playlists?.length" class="mb-12">
      <h2 class="text-lg font-semibold mb-4">Playlists</h2>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <NuxtLink
          v-for="playlist in data.playlists"
          :key="playlist.id"
          :to="`/browse/playlist/${playlist.id}`"
          class="group"
          :class="{ 'opacity-50 pointer-events-none': !playlist.isAvailable || bucketFor(playlist)?.locked }"
        >
          <div class="relative">
            <img
              :src="playlist.playlistThumbnail"
              :alt="playlist.playlistTitle"
              class="w-full aspect-video object-cover rounded-lg group-hover:ring-2 ring-primary-500 transition"
            />
            <div class="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
              Playlist
            </div>
          </div>
          <p class="mt-2 font-medium truncate">{{ playlist.playlistTitle }}</p>
          <p v-if="!playlist.isAvailable" class="text-xs text-red-500">Unavailable</p>
          <p v-else-if="bucketFor(playlist)?.locked" class="text-xs text-amber-600">{{ playlist.contentRule === 'exempt' ? 'Safety Cap used' : 'Daily Allowance used' }}</p>
          <p v-else-if="ruleLabel(playlist)" class="text-xs text-green-600">{{ ruleLabel(playlist) }}</p>
        </NuxtLink>
      </div>
    </section>

    <!-- Videos Section -->
    <section v-if="data?.videos?.length" class="mb-12">
      <h2 class="text-lg font-semibold mb-4">Videos</h2>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <NuxtLink
          v-for="video in data.videos"
          :key="video.id"
          :to="`/watch?v=${video.videoId}`"
          class="group"
          :class="{ 'opacity-50 pointer-events-none': !video.isAvailable || bucketFor(video)?.locked }"
        >
          <div class="relative">
            <img
              :src="video.videoThumbnail"
              :alt="video.videoTitle"
              class="w-full aspect-video object-cover rounded-lg group-hover:ring-2 ring-primary-500 transition"
            />
            <span v-if="video.duration" class="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
              {{ formatDuration(video.duration) }}
            </span>
          </div>
          <p class="mt-2 font-medium line-clamp-2">{{ video.videoTitle }}</p>
          <p class="text-sm text-gray-500 truncate">{{ video.channelTitle }}</p>
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
