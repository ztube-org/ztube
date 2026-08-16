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
  <div>
    <div class="flex items-center gap-4 mb-8">
      <NuxtLink to="/browse">
        <UButton color="gray" variant="ghost" icon="i-heroicons-arrow-left" />
      </NuxtLink>
      <UAvatar
        v-if="data?.channel?.thumbnail"
        :src="data.channel.thumbnail"
        size="lg"
      />
      <h1 class="text-2xl font-bold">{{ data?.channel?.title }}</h1>
    </div>

    <div v-if="!data?.videos?.length" class="text-center py-16 text-gray-500">
      No videos from this channel yet
    </div>

    <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      <NuxtLink
        v-for="video in data.videos"
        :key="video.id"
        :to="`/watch?v=${video.videoId}`"
        class="group"
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
      </NuxtLink>
    </div>
  </div>
</template>
