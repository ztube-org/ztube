<script setup lang="ts">
import { useSourceVideos } from '../composables/use-source-videos'
import type { ApprovedSourceKind } from '../../src/domain'

const props = defineProps<{ kind: ApprovedSourceKind; sourceId: string }>()
const { data, source, loadError, loadingMore, search, filteredVideos, blocked, loadMore, toggleFavorite } = useSourceVideos(props.kind, props.sourceId)
const label = props.kind === 'channel' ? 'Channel' : 'Playlist'
const formatDuration = (seconds: number | null) => seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : ''
const formatPublishedDate = (value: string | null) => value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(value)) : ''
</script>

<template>
  <div class="zt-page">
    <div class="mb-5 flex items-center gap-3 border-b border-gray-200 pb-4 sm:gap-4">
      <NuxtLink to="/browse" class="flex min-h-11 min-w-11 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100" aria-label="Back to browse"><UIcon name="i-heroicons-arrow-left" class="h-5 w-5" /></NuxtLink>
      <UAvatar v-if="kind === 'channel' && source?.thumbnail" :src="source.thumbnail" size="lg" />
      <img v-else-if="source?.thumbnail" :src="source.thumbnail" :alt="source.title" class="h-16 w-28 rounded-lg object-cover" />
      <div class="min-w-0 flex-1"><p class="text-sm font-medium text-[#065fd4]">{{ label }}</p><h1 class="truncate text-2xl font-bold tracking-tight">{{ source?.title }}</h1></div>
      <span class="hidden text-xs text-gray-500 sm:block">Updated automatically</span>
    </div>

    <UAlert v-if="loadError" color="red" :title="`Unable to load ${kind} videos`" :description="loadError" class="mb-4" />
    <UAlert v-else-if="data?.policy.blocked" color="warning" title="Videos are visible, but playback is unavailable right now" class="mb-4" />
    <UInput v-if="data?.videos.length" v-model="search" icon="i-heroicons-magnifying-glass" placeholder="Search videos" class="mb-4 w-full" />
    <div v-if="!data && !loadError" class="py-12 text-center text-gray-500">Loading {{ kind }} videos…</div>
    <div v-else-if="data && !data.videos.length" class="py-12 text-center text-gray-500">No videos have synced yet. Ask the Admin to sync this {{ kind }}.</div>
    <div v-else-if="filteredVideos.length" class="zt-video-grid">
      <NuxtLink v-for="video in filteredVideos" :key="video.videoId" :to="`/watch?v=${video.videoId}&${kind}=${sourceId}`" class="zt-video-card group" :class="{ 'pointer-events-none opacity-50': blocked(video) }">
        <div class="zt-video-card__media">
          <img :src="video.videoThumbnail || undefined" :alt="video.videoTitle" class="zt-thumbnail" />
          <span v-if="video.duration" class="zt-duration">{{ formatDuration(video.duration) }}</span>
          <UButton :icon="data?.favoriteVideoIds.includes(video.videoId) ? 'i-heroicons-star-solid' : 'i-heroicons-star'" color="neutral" variant="solid" size="xs" class="zt-video-card__favorite" :aria-label="data?.favoriteVideoIds.includes(video.videoId) ? 'Remove from Favorites' : 'Add to Favorites'" @click.prevent.stop="toggleFavorite(video.videoId)" />
        </div>
        <p class="mt-3 font-semibold leading-5 line-clamp-2">{{ video.videoTitle }}</p>
        <p v-if="kind === 'playlist'" class="mt-1 truncate text-sm text-[#606060]">{{ video.channelTitle }}</p>
        <p v-if="video.publishedAt" class="mt-1 text-sm text-[#606060]">{{ formatPublishedDate(video.publishedAt) }}</p>
        <p v-if="blocked(video)" class="text-xs text-amber-600">Playback unavailable right now</p>
      </NuxtLink>
    </div>
    <div v-else-if="data" class="py-12 text-center text-gray-500">No videos match this search.</div>
    <div v-if="data && data.nextPage !== null" class="mt-5 flex justify-center"><UButton variant="soft" class="min-h-11" :loading="loadingMore" @click="loadMore">Load more videos</UButton></div>
  </div>
</template>
