<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useBrowseMemory } from '../composables/use-browse-memory'
import { formatDuration } from '../../src/video-ui'
import { useSourceVideos } from '../composables/use-source-videos'
import { apiFetch } from '../../src/api'
import type { BrowseResponse, SeriesNavigation } from '../../src/domain'
import type { ApprovedSourceKind } from '../../src/domain'
import VideoCard from './VideoCard.vue'
import MediaArtwork from './MediaArtwork.vue'
import ViewingStatus from './ViewingStatus.vue'

const props = defineProps<{ kind: ApprovedSourceKind; sourceId: string }>()
const { data, source, loadError, loading, loadingMore, search, filteredVideos, blocked, loadMore, canLoadMore, refresh, toggleFavorite, favoriteError, favoritePending, viewing } = useSourceVideos(props.kind, props.sourceId)
const { status, error: statusError, refreshing, refresh: refreshStatus } = viewing
const { season } = useBrowseMemory(`season:${props.kind}:${props.sourceId}`, () => ({ season: ref('') }))
const seasons = computed(() => [...new Set((data.value?.videos ?? []).map(video => video.season ?? '').filter(Boolean))])
const selectedSeason = computed({
  get: () => seasons.value.includes(season.value) ? season.value : seasons.value[0] ?? '',
  set: value => { season.value = value },
})
const episodes = computed(() => filteredVideos.value.filter(video => !selectedSeason.value || video.season === selectedSeason.value))
const isJellyfin = computed(() => data.value?.videos.some(video => video.videoId.startsWith('jf:')) ?? false)
const isUnlocked = (videoId: string) => data.value?.unlockedVideoIds?.includes(videoId) ?? false
const nextChoice = ref<SeriesNavigation | null>(null)
onMounted(() => { if (props.kind === 'playlist') void apiFetch<BrowseResponse>('/api/child/browse').then(result => { nextChoice.value = result.seriesNavigation?.find(item => item.playlistId === Number(props.sourceId)) ?? null }).catch(() => {}) })
const label = computed(() => props.kind === 'channel' ? 'Channel' : isJellyfin.value ? 'Series' : 'Playlist')
</script>

<template>
  <div class="zt-page">
    <div class="mb-4 flex items-center gap-3 border-b border-[var(--zt-border)] pb-3">
      <NuxtLink :to="isJellyfin ? '/cartoon-pool' : '/browse'" class="zt-icon-link flex min-h-11 min-w-11 items-center justify-center rounded-full" :aria-label="isJellyfin ? 'Back to Jellyfin' : 'Back to browse'"><UIcon name="i-heroicons-arrow-left" class="h-5 w-5" /></NuxtLink>
      <UAvatar v-if="kind === 'channel' && source" :src="source.thumbnail || undefined" :alt="source.title" size="lg" />
      <MediaArtwork v-else-if="source" :src="source.thumbnail" :title="source.title" kind="playlist" compact class="h-12 w-20 shrink-0 rounded-lg" />
      <div class="min-w-0 flex-1"><p class="text-xs font-medium text-[var(--zt-blue)]">{{ label }}</p><h1 class="truncate text-xl font-bold">{{ source?.title }}</h1></div>
    </div>
    <ViewingStatus :status="status || data" :error="statusError" :refreshing="refreshing" class="mb-3" @refresh="refreshStatus" />
    <section v-if="nextChoice" class="mb-4 rounded-xl border border-[var(--zt-border)] p-3" aria-label="Choose what to watch next">
      <h2 class="font-semibold">Choose what to watch next</h2><p class="my-2 text-sm text-[var(--zt-muted)]">Unlocked episodes need no credit. New episodes ask you to confirm using one credit.</p>
      <div class="grid gap-3 sm:grid-cols-2"><NuxtLink v-if="nextChoice.nextVideoId" :to="`/watch?v=${nextChoice.nextVideoId}&playlist=${sourceId}`" class="min-h-11 rounded-lg bg-[var(--zt-blue-soft)] p-3"><p class="text-sm text-[var(--zt-blue)]">Next episode</p><p class="font-semibold">{{ nextChoice.nextTitle }}</p><p class="mt-1 text-xs">Review before unlocking →</p></NuxtLink>
      <NuxtLink :to="`/watch?v=${nextChoice.previousVideoId}&playlist=${sourceId}`" class="min-h-11 rounded-lg border border-[var(--zt-border)] p-3"><p class="text-sm text-[var(--zt-muted)]">Last unlocked</p><p class="font-semibold">{{ nextChoice.previousTitle }}</p><p class="mt-1 text-xs">Play without another credit →</p></NuxtLink></div>
      <p v-if="!nextChoice.nextVideoId" class="mt-2 text-sm text-[var(--zt-muted)]">You’ve reached the last available episode in this series or season.</p>
    </section>
    <UInput v-model="search" icon="i-heroicons-magnifying-glass" placeholder="Search all videos in this source" aria-label="Search all videos in this source" class="mb-4 w-full" />
    <div v-if="loadError" role="alert" class="mb-4 flex items-center gap-3"><span>{{ loadError }}</span><UButton variant="soft" @click="refresh">Retry</UButton></div>
    <p v-if="favoriteError" role="alert" class="mb-3 text-sm text-red-600">{{ favoriteError }}</p>
    <div v-if="loading" role="status" class="py-8 text-center text-[var(--zt-muted)]">Loading videos…</div>
    <template v-else-if="source?.curated">
      <label v-if="seasons.length" class="mb-3 flex items-center gap-2">Season<select v-model="selectedSeason" class="min-h-11 rounded-lg border bg-[var(--zt-surface)] px-3"><option v-for="name in seasons" :key="name" :value="name">{{ name }}</option></select></label>
      <div class="divide-y rounded-xl border">
        <div v-for="video in episodes" :key="video.videoId" class="flex items-center gap-2 border-l-4 p-2" :class="video.requiresClaim && isUnlocked(video.videoId) ? 'border-l-[var(--zt-blue)] bg-[var(--zt-blue-soft)]' : 'border-l-transparent'">
          <NuxtLink :to="`/watch?v=${video.videoId}&playlist=${sourceId}`" class="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-lg" :aria-disabled="Boolean(blocked(video))" @click.capture="blocked(video) && $event.preventDefault()">
            <span class="w-8 shrink-0 text-center text-lg font-semibold tabular-nums">{{ (video.position ?? 0) + 1 }}</span>
            <MediaArtwork :src="video.videoThumbnail" :title="video.videoTitle" compact class="hidden h-14 w-24 shrink-0 rounded sm:block" />
            <div class="min-w-0"><p class="font-semibold">{{ video.videoTitle }}</p><p class="text-sm text-[var(--zt-muted)]">{{ video.season }} · {{ formatDuration(video.duration ?? 0) }}<span v-if="video.positionSeconds"> · Resume at {{ formatDuration(video.positionSeconds) }}</span></p><p v-if="video.requiresClaim" class="mt-1 flex items-center gap-1 text-sm font-medium" :class="isUnlocked(video.videoId) ? 'text-[var(--zt-blue)]' : 'text-amber-700 dark:text-amber-300'"><UIcon :name="isUnlocked(video.videoId) ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed'" />{{ isUnlocked(video.videoId) ? 'Unlocked' : '1 credit to unlock' }}</p><p v-if="blocked(video)" class="text-sm text-amber-700">{{ blocked(video) }}</p></div>
          </NuxtLink>
          <UButton :icon="data?.favoriteVideoIds.includes(video.videoId) ? 'i-heroicons-star-solid' : 'i-heroicons-star'" variant="ghost" class="min-h-11 min-w-11" :aria-label="`Favorite ${video.videoTitle}`" :loading="favoritePending.has(video.videoId)" @click="toggleFavorite(video.videoId)" />
        </div>
      </div>
      <p v-if="!episodes.length" class="py-6 text-center text-[var(--zt-muted)]">No available episodes match this selection.</p>
    </template>
    <div v-else-if="filteredVideos.length" class="zt-video-grid">
      <VideoCard v-for="video in filteredVideos" :key="video.videoId" :video="video" :to="`/watch?v=${video.videoId}&${kind}=${sourceId}`" :favorite="data?.favoriteVideoIds.includes(video.videoId)" :pending="favoritePending.has(video.videoId)" :unavailable="blocked(video)" show-date @favorite="toggleFavorite(video.videoId)" />
    </div>
    <div v-else-if="data && !loadError && !canLoadMore" class="py-10 text-center text-[var(--zt-muted)]">{{ search.trim() ? 'No videos match this search.' : 'No videos have synced yet. Ask an Admin to sync this source.' }}</div>
    <div v-if="!loading && canLoadMore" class="mt-5 flex justify-center"><UButton variant="soft" :loading="loadingMore" @click="loadMore">Load more videos</UButton></div>
  </div>
</template>
