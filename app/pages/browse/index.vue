<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import LibraryNav from '../../components/LibraryNav.vue'
import { apiFetch } from '../../../src/api'
import type { ApprovedVideo, BrowseResponse, SourceVideosResponse } from '../../../src/domain'
import { videoUnavailable } from '../../../src/video-ui'
import { useBrowseMemory } from '../../composables/use-browse-memory'
import { useFavorites } from '../../composables/use-favorites'
import { useViewingStatus } from '../../composables/use-viewing-status'
import VideoCard from '../../components/VideoCard.vue'
import MediaArtwork from '../../components/MediaArtwork.vue'
import ViewingStatus from '../../components/ViewingStatus.vue'

const { data, contentSearch, selectedTag, results } = useBrowseMemory('browse', () => ({ data: ref<BrowseResponse | null>(null), contentSearch: ref(''), selectedTag: ref(''), results: ref<SourceVideosResponse | null>(null) }))
const loading = ref(!data.value)
const loadError = ref('')
let disposed = false
const { status, error: statusError, refreshing, refresh: refreshStatus } = useViewingStatus(() => data.value)
const favorite = useFavorites(() => data.value?.favoriteVideoIds ?? [], ids => { if (data.value) data.value.favoriteVideoIds = ids })
const { error: favoriteError, pending: favoritePending } = favorite
const searching = computed(() => Boolean(contentSearch.value.trim() || selectedTag.value))
const visibleVideo = (video: ApprovedVideo) => !video.videoId.startsWith('ol:') && !video.videoId.startsWith('jf:')
const visiblePlaylists = computed(() => (data.value?.playlists ?? []).filter(item => !item.playlistId?.startsWith('pl:')))
const continuation = computed(() => (data.value?.continueWatching ?? []).filter(visibleVideo))
const recommendations = computed(() => (data.value?.recommendations ?? []).filter(visibleVideo))
const favorites = computed(() => (data.value?.favorites ?? []).filter(visibleVideo))
const allTags = computed(() => [...new Set([...(data.value?.channels ?? []), ...visiblePlaylists.value, ...(data.value?.videos ?? []).filter(visibleVideo)].flatMap(item => item.tags ?? []))].sort())
function matches(item: { tags?: string[] }, title: string) {
  return (!contentSearch.value.trim() || `${title} ${(item.tags ?? []).join(' ')}`.toLowerCase().includes(contentSearch.value.trim().toLowerCase())) && (!selectedTag.value || item.tags?.includes(selectedTag.value))
}
const filteredChannels = computed(() => (data.value?.channels ?? []).filter(item => matches(item, item.channelTitle)))
const filteredPlaylists = computed(() => visiblePlaylists.value.filter(item => matches(item, item.playlistTitle)))
const displayedVideos = computed(() => (searching.value ? results.value?.videos ?? [] : data.value?.videos ?? []).filter(visibleVideo))
const emptyLibrary = computed(() => data.value && !data.value.channels.length && !visiblePlaylists.value.length && !displayedVideos.value.length)
const unavailable = (video: ApprovedVideo) => videoUnavailable(video, status.value ?? data.value)
async function refresh() {
  loading.value = !data.value
  loadError.value = ''
  try {
    const result = await apiFetch<BrowseResponse>('/api/child/browse')
    if (!disposed) data.value = result
  } catch (cause) { if (!disposed) loadError.value = cause instanceof Error ? cause.message : 'Unable to load your videos' }
  finally { if (!disposed) loading.value = false }
}
async function toggleFavorite(video: ApprovedVideo) {
  if (data.value?.favoriteVideoIds.includes(video.videoId) && !confirm(`Remove “${video.videoTitle}” from Favorites?`)) return
  if (await favorite.toggle(video.videoId) && data.value) {
    data.value.favorites = data.value.favoriteVideoIds.includes(video.videoId)
      ? [...data.value.favorites.filter(item => item.videoId !== video.videoId), video]
      : data.value.favorites.filter(item => item.videoId !== video.videoId)
  }
}
const searchLoading = ref(false)
const searchError = ref('')
let generation = 0
let debounce: ReturnType<typeof setTimeout> | undefined
async function searchVideos(more = false) {
  if (!searching.value || (more && (searchLoading.value || results.value?.nextPage == null))) return
  const current = ++generation
  searchLoading.value = true
  searchError.value = ''
  try {
    const query = new URLSearchParams({ q: contentSearch.value.trim(), tag: selectedTag.value, page: String(more ? results.value!.nextPage : 0) })
    const result = await apiFetch<SourceVideosResponse>(`/api/child/search?${query}`)
    if (!disposed && current === generation) results.value = more && results.value ? { ...result, videos: [...results.value.videos, ...result.videos] } : result
  } catch (cause) { if (!disposed && current === generation) searchError.value = cause instanceof Error ? cause.message : 'Search failed' }
  finally { if (!disposed && current === generation) searchLoading.value = false }
}
watch([contentSearch, selectedTag], () => {
  generation++
  clearTimeout(debounce)
  searchLoading.value = searching.value
  results.value = null
  debounce = setTimeout(() => { void searchVideos() }, 250)
})
onMounted(() => { void refresh(); if (searching.value && !results.value) void searchVideos() })
onBeforeUnmount(() => { disposed = true; clearTimeout(debounce) })
</script>

<template>
  <div class="zt-page">
    <h1 class="sr-only">YouTube</h1>
    <header class="zt-library-toolbar">
      <LibraryNav />
      <div class="flex min-w-0 gap-2 sm:w-80"><UInput v-model="contentSearch" icon="i-heroicons-magnifying-glass" placeholder="Search your library" aria-label="Search your videos, channels, or tags" class="min-w-0 flex-1" /><UButton v-if="searching" color="neutral" variant="soft" @click="contentSearch = ''; selectedTag = ''">Clear</UButton></div>
    </header>
    <ViewingStatus :status="status || data" :error="statusError" :refreshing="refreshing" class="mb-5" @refresh="refreshStatus" />
    <div v-if="allTags.length" class="mb-4 flex items-center gap-2 overflow-x-auto" aria-label="Content tags">
      <span class="shrink-0 text-xs text-[var(--zt-muted)]">Topics</span>
      <UButton :variant="selectedTag ? 'ghost' : 'soft'" color="neutral" class="shrink-0 min-h-11" @click="selectedTag = ''">All</UButton>
      <UButton v-for="tag in allTags" :key="tag" :variant="selectedTag === tag ? 'soft' : 'ghost'" color="neutral" class="shrink-0 min-h-11" @click="selectedTag = tag">{{ tag }}</UButton>
    </div>
    <div v-if="loadError" role="alert" class="mb-4 flex items-center gap-3"><span>{{ loadError }}</span><UButton variant="soft" @click="refresh">Retry</UButton></div>
    <p v-if="favoriteError" role="alert" class="mb-3 text-sm text-red-600">{{ favoriteError }}</p>
    <p v-if="loading" role="status" class="py-10 text-center text-[var(--zt-muted)]">Loading your videos…</p>

    <template v-if="!searching">
      <section v-if="continuation.length" class="mb-6">
        <h2 class="zt-section-title">Continue Watching</h2>
        <div class="zt-video-shelf"><VideoCard v-for="video in continuation" :key="video.videoId" :video="video" :to="`/watch?v=${video.videoId}`" :unavailable="unavailable(video)" /></div>
      </section>
      <section v-if="recommendations.length" class="mb-6 rounded-xl bg-[var(--zt-blue-soft)] p-3">
        <div class="mb-3 flex items-center gap-2"><h2 class="text-lg font-bold">New for You</h2><UBadge color="primary">{{ recommendations.length }} new</UBadge></div>
        <div class="zt-video-shelf"><VideoCard v-for="video in recommendations" :key="video.videoId" :video="video" :to="`/watch?v=${video.videoId}`" :unavailable="unavailable(video)" is-new /></div>
      </section>
      <section v-if="favorites.length" id="favorites" class="mb-6 scroll-mt-16">
        <h2 class="zt-section-title">Favorites</h2>
        <div class="zt-video-shelf"><VideoCard v-for="video in favorites" :key="video.videoId" :video="video" :to="`/watch?v=${video.videoId}`" :favorite="true" :pending="favoritePending.has(video.videoId)" :unavailable="unavailable(video)" @favorite="toggleFavorite(video)" /></div>
      </section>
    </template>

    <p v-if="searching" class="mb-3 text-sm text-[var(--zt-muted)]" role="status">{{ searchLoading ? 'Searching your library…' : `${filteredChannels.length + filteredPlaylists.length + displayedVideos.length}${results?.nextPage != null ? '+' : ''} results` }}</p>
    <div v-if="searchError && searching" role="alert" class="mb-3 flex gap-3"><span>{{ searchError }}</span><UButton variant="soft" @click="searchVideos()">Retry search</UButton></div>
    <section v-if="filteredChannels.length" id="channels" class="mb-6 scroll-mt-16">
      <h2 class="zt-section-title">Channels</h2>
      <div class="zt-channel-grid">
        <NuxtLink v-for="channel in filteredChannels" :key="channel.id" :to="`/browse/channel/${channel.id}`" class="zt-channel-link">
          <UAvatar :src="channel.channelThumbnail || undefined" :alt="channel.channelTitle" class="h-12 w-12 shrink-0" />
          <p class="truncate text-sm font-medium">{{ channel.channelTitle }}</p>
          <p v-if="!channel.isAvailable" class="text-xs text-amber-700 dark:text-amber-300">Tap to reload videos</p>
        </NuxtLink>
      </div>
    </section>
    <section v-if="filteredPlaylists.length" class="mb-6">
      <h2 class="zt-section-title">Playlists</h2>
      <div class="zt-video-grid">
        <NuxtLink v-for="playlist in filteredPlaylists" :key="playlist.id" :to="`/browse/playlist/${playlist.id}`" class="zt-video-card">
          <div class="zt-video-card__media"><MediaArtwork :src="playlist.playlistThumbnail" :title="playlist.playlistTitle" kind="playlist" /><span class="zt-duration">{{ playlist.playlistId?.startsWith('pl:jf:') ? 'Series' : 'Playlist' }}</span></div>
          <p class="mt-2 font-semibold leading-5 line-clamp-2">{{ playlist.playlistTitle }}</p>
          <p v-if="!playlist.isAvailable" class="text-xs text-amber-700 dark:text-amber-300">Tap to reload videos</p>
        </NuxtLink>
      </div>
    </section>
    <section v-if="displayedVideos.length || (searching && results?.nextPage != null)" class="mb-6">
      <h2 class="zt-section-title">Videos</h2>
      <div class="zt-video-grid"><VideoCard v-for="video in displayedVideos" :key="video.videoId" :video="video" :to="`/watch?v=${video.videoId}`" :favorite="data?.favoriteVideoIds.includes(video.videoId) ?? false" :pending="favoritePending.has(video.videoId)" :unavailable="unavailable(video)" show-date @favorite="toggleFavorite(video)" /></div>
      <UButton v-if="searching && results?.nextPage != null" class="mt-4" variant="soft" :loading="searchLoading" @click="searchVideos(true)">Load more results</UButton>
    </section>
    <p v-if="searching && !searchLoading && !searchError && !filteredChannels.length && !filteredPlaylists.length && !displayedVideos.length && results?.nextPage == null" class="py-10 text-center text-[var(--zt-muted)]">No content matches this search. Try another word or clear the filters.</p>
    <div v-else-if="!loading && !loadError && !searching && emptyLibrary" class="py-10 text-center text-[var(--zt-muted)]"><p class="text-lg">No content yet!</p><p>Ask an Admin to add some channels, playlists, or videos.</p></div>
  </div>
</template>
