<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useApi } from '../../../../src/api'

const route = useRoute()
const channelId = route.params.id as string

const { data } = useApi<any>(`/api/child/channel/${channelId}/videos`)

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <div class="zt-page">
    <div class="mb-8 flex items-center gap-4 border-b border-gray-200 pb-6">
      <NuxtLink to="/browse">
        <UButton color="gray" variant="ghost" icon="i-heroicons-arrow-left" />
      </NuxtLink>
      <UAvatar
        v-if="data?.channel?.thumbnail"
        :src="data.channel.thumbnail"
        size="lg"
      />
      <div>
        <p class="text-sm font-medium text-[#065fd4]">Channel</p>
        <h1 class="text-2xl font-bold tracking-tight">{{ data?.channel?.title }}</h1>
      </div>
    </div>

    <div v-if="data?.channel && !data.channel.isAvailable" class="text-center py-16 text-red-600">
      Unable to load videos from this channel. Please try again later.
    </div>

    <div v-else-if="!data?.videos?.length" class="text-center py-16 text-gray-500">
      Loading channel videos…
    </div>

    <div v-else class="zt-video-grid">
      <NuxtLink
        v-for="video in data.videos"
        :key="video.id"
        :to="`/watch?v=${video.videoId}`"
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
        </div>
        <p class="mt-3 font-semibold leading-5 line-clamp-2">{{ video.videoTitle }}</p>
      </NuxtLink>
    </div>
  </div>
</template>
