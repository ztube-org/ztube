<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { ApprovedVideo } from '../../src/domain'
import { formatDuration, formatPublishedDate } from '../../src/video-ui'
import MediaArtwork from './MediaArtwork.vue'

withDefaults(defineProps<{ video: ApprovedVideo; to: RouteLocationRaw; favorite?: boolean; pending?: boolean; unavailable?: string; isNew?: boolean; showDate?: boolean }>(), { favorite: undefined })
defineEmits<{ favorite: [] }>()
</script>

<template>
  <article class="zt-video-card relative">
    <NuxtLink :to="to" class="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4" :class="{ 'opacity-60': unavailable }" :aria-disabled="Boolean(unavailable)" :tabindex="unavailable ? -1 : undefined" :aria-label="unavailable ? `${video.videoTitle}: ${unavailable}` : video.videoTitle" @click.capture="unavailable && $event.preventDefault()">
      <div class="zt-video-card__media">
        <MediaArtwork :src="video.videoThumbnail" :title="video.videoTitle" />
        <span v-if="video.duration" class="zt-duration">{{ video.positionSeconds ? `${formatDuration(video.positionSeconds)} / ` : '' }}{{ formatDuration(video.duration) }}</span>
        <UBadge v-if="isNew" color="primary" variant="solid" class="absolute left-2 top-2">NEW</UBadge>
        <div v-if="video.positionSeconds && video.duration" class="absolute inset-x-0 bottom-0 h-1 bg-gray-300"><div class="h-full bg-[var(--zt-blue)]" :style="{ width: `${Math.min(100, video.positionSeconds / video.duration * 100)}%` }" /></div>
      </div>
      <p class="mt-2 font-semibold leading-5 line-clamp-2">{{ video.videoTitle }}</p>
      <p class="mt-1 truncate text-sm text-[var(--zt-muted)]">{{ video.channelTitle }}</p>
      <p v-if="showDate && video.publishedAt" class="mt-1 text-xs text-[var(--zt-muted)]">{{ formatPublishedDate(video.publishedAt) }}</p>
      <p v-if="unavailable" class="mt-1 text-xs text-amber-700 dark:text-amber-300">{{ unavailable }}</p>
    </NuxtLink>
    <UButton v-if="favorite !== undefined" :icon="favorite ? 'i-heroicons-star-solid' : 'i-heroicons-star'" color="neutral" variant="solid" class="zt-video-card__favorite" :loading="pending" :aria-label="favorite ? `Remove ${video.videoTitle} from Favorites` : `Add ${video.videoTitle} to Favorites`" :aria-pressed="favorite" @click="$emit('favorite')" />
  </article>
</template>
