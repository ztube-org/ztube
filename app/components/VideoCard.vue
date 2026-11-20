<script setup lang="ts">
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import type { ApprovedVideo } from '../../src/domain'
import { formatDuration, formatPublishedDate } from '../../src/video-ui'
import MediaArtwork from './MediaArtwork.vue'

const props = withDefaults(defineProps<{ video: ApprovedVideo; to: RouteLocationRaw; favorite?: boolean; pending?: boolean; unavailable?: string; isNew?: boolean; showDate?: boolean }>(), { favorite: undefined })
defineEmits<{ favorite: [] }>()
const progress = computed(() => {
  const { positionSeconds, duration } = props.video
  return positionSeconds && duration && duration > 0 ? Math.min(duration, Math.max(0, positionSeconds)) : 0
})
</script>

<template>
  <article class="zt-video-card relative">
    <NuxtLink :to="to" class="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4" :class="{ 'opacity-60': unavailable }" :aria-disabled="Boolean(unavailable)" :tabindex="unavailable ? -1 : undefined" :aria-label="unavailable ? `${video.videoTitle}: ${unavailable}` : video.videoTitle" @click.capture="unavailable && $event.preventDefault()">
      <div class="zt-video-card__media zt-video-artwork">
        <MediaArtwork :src="video.videoThumbnail" :title="video.videoTitle" />
        <span v-if="video.duration" class="zt-duration" :class="{ 'zt-duration--progress': progress }">{{ progress ? `${formatDuration(progress)} / ` : '' }}{{ formatDuration(video.duration) }}</span>
        <span v-if="isNew" class="zt-new-badge">New</span>
        <progress v-if="progress && video.duration" class="zt-video-progress" :value="progress" :max="video.duration" aria-hidden="true" />
      </div>
      <p class="mt-2 font-semibold leading-5 line-clamp-2">{{ video.videoTitle }}</p>
      <p class="mt-1 truncate text-sm text-[var(--zt-muted)]">{{ video.channelTitle }}</p>
      <p v-if="showDate && video.publishedAt" class="mt-1 text-xs text-[var(--zt-muted)]">{{ formatPublishedDate(video.publishedAt) }}</p>
      <p v-if="unavailable" class="mt-1 text-xs text-[var(--zt-warning)]">{{ unavailable }}</p>
    </NuxtLink>
    <UButton v-if="favorite !== undefined" :icon="favorite ? 'i-heroicons-star-solid' : 'i-heroicons-star'" color="neutral" variant="solid" class="zt-video-card__favorite" :loading="pending" :aria-label="favorite ? `Remove ${video.videoTitle} from Favorites` : `Add ${video.videoTitle} to Favorites`" :aria-pressed="favorite" @click="$emit('favorite')" />
  </article>
</template>
