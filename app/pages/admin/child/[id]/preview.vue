<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { apiFetch, useApi } from '../../../../../src/api'
import type { ApprovedVideo, BrowseResponse, SourceVideosResponse } from '../../../../../src/domain'
import { formatDuration, videoUnavailable } from '../../../../../src/video-ui'
import MediaArtwork from '../../../../components/MediaArtwork.vue'
import ViewingStatus from '../../../../components/ViewingStatus.vue'

const route = useRoute()
const childId = Number(route.params.id)
const base = `/admin/child/${childId}/preview`
const { data: profile } = useApi<{ child: { displayName: string | null; email: string } }>(`/api/admin/children/${childId}/content`)
const library = ref<BrowseResponse | null>(null)
const source = ref<SourceVideosResponse | null>(null)
const results = ref<SourceVideosResponse | null>(null)
const error = ref('')
const loading = ref(false)
const searching = ref(false)
const search = ref('')
const tag = ref('')
const section = ref<'youtube' | 'jellyfin'>('youtube')
const sourceKind = computed(() => route.query.kind === 'channel' || route.query.kind === 'playlist' ? route.query.kind : null)
const sourceId = computed(() => typeof route.query.source === 'string' ? route.query.source : null)
const sourceTitle = computed(() => sourceKind.value ? source.value?.[sourceKind.value]?.title : null)
const isSource = computed(() => Boolean(sourceKind.value && sourceId.value))
const visible = (video: ApprovedVideo) => !video.videoId.startsWith('ol:') && !video.videoId.startsWith('jf:')
const youtubePlaylists = computed(() => (library.value?.playlists ?? []).filter(p => !p.playlistId?.startsWith('pl:')))
const jellyfinPlaylists = computed(() => (library.value?.playlists ?? []).filter(p => p.playlistId?.startsWith('pl:jf:')))
const matches = (title: string, tags: string[]) => (!search.value.trim() || `${title} ${tags.join(' ')}`.toLowerCase().includes(search.value.trim().toLowerCase())) && (!tag.value || tags.includes(tag.value))
const channels = computed(() => (library.value?.channels ?? []).filter(item => matches(item.channelTitle, item.tags ?? [])))
const playlists = computed(() => youtubePlaylists.value.filter(item => matches(item.playlistTitle, item.tags ?? [])))
const tags = computed(() => [...new Set([...(library.value?.channels ?? []), ...youtubePlaylists.value, ...(library.value?.videos ?? []).filter(visible)].flatMap(item => item.tags ?? []))].sort())
const filteredVideos = computed(() => (search.value.trim() || tag.value ? results.value?.videos ?? [] : library.value?.videos ?? []).filter(visible))
const status = computed(() => source.value ?? library.value)
const destination = (kind: 'channel' | 'playlist', id: number) => ({ path: base, query: { kind, source: String(id) } })
let libraryRequest = 0
let sourceRequest = 0
let searchRequest = 0
async function loadLibrary() {
  const current = ++libraryRequest
  loading.value = true
  error.value = ''
  try {
    const value = await apiFetch<BrowseResponse>(`/api/admin/children/${childId}/preview`)
    if (current === libraryRequest) library.value = value
  } catch (cause) { if (current === libraryRequest) error.value = cause instanceof Error ? cause.message : 'Unable to load preview' }
  finally { if (current === libraryRequest) loading.value = false }
}
async function loadSource(more = false) {
  if (!sourceKind.value || !sourceId.value || (more && (loading.value || source.value?.nextPage == null))) return
  const current = ++sourceRequest
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({ page: String(more ? source.value!.nextPage : 0), q: search.value.trim() })
    const value = await apiFetch<SourceVideosResponse>(`/api/admin/children/${childId}/preview/${sourceKind.value}/${encodeURIComponent(sourceId.value)}?${params}`)
    if (current === sourceRequest) source.value = more && source.value ? { ...value, videos: [...source.value.videos, ...value.videos] } : value
  } catch (cause) { if (current === sourceRequest) error.value = cause instanceof Error ? cause.message : 'Unable to load videos' }
  finally { if (current === sourceRequest) loading.value = false }
}
async function searchVideos(more = false) {
  if (more && (searching.value || results.value?.nextPage == null)) return
  const current = ++searchRequest
  searching.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({ q: search.value.trim(), tag: tag.value, page: String(more ? results.value!.nextPage : 0) })
    const value = await apiFetch<SourceVideosResponse>(`/api/admin/children/${childId}/preview/search?${params}`)
    if (current === searchRequest) results.value = more && results.value ? { ...value, videos: [...results.value.videos, ...value.videos] } : value
  } catch (cause) { if (current === searchRequest) error.value = cause instanceof Error ? cause.message : 'Unable to search videos' }
  finally { if (current === searchRequest) searching.value = false }
}
let debounce: ReturnType<typeof setTimeout> | undefined
watch([sourceKind, sourceId], () => {
  clearTimeout(debounce)
  source.value = null
  search.value = ''
  sourceRequest++
  searchRequest++
  if (isSource.value) void loadSource()
  else if (!library.value) void loadLibrary()
})
watch([search, tag], () => {
  clearTimeout(debounce)
  if (isSource.value) { source.value = null; sourceRequest++; debounce = setTimeout(() => { void loadSource() }, 250) }
  else if (search.value.trim() || tag.value) { results.value = null; searchRequest++; debounce = setTimeout(() => { void searchVideos() }, 250) }
  else { results.value = null; searchRequest++ }
})
onMounted(() => { void loadLibrary(); if (isSource.value) void loadSource() })
</script>

<template>
  <div class="zt-page">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--zt-border)] bg-[var(--zt-blue-soft)] px-3 py-2">
      <div><p class="font-semibold">Viewer preview · {{ profile?.child.displayName || profile?.child.email || 'Child' }}</p><p class="text-xs text-[var(--zt-muted)]">Read-only: playback, favorites and unlocks are disabled. This does not switch accounts.</p></div>
      <UButton :to="`/admin/child/${childId}/manage`" variant="soft" class="min-h-11">Back to settings</UButton>
    </div>
    <div v-if="!isSource" class="zt-library-toolbar mb-4">
      <nav class="zt-library-nav" aria-label="Library sections">
        <button class="min-h-11" :aria-current="section === 'youtube' ? 'page' : undefined" @click="section = 'youtube'"><UIcon name="i-heroicons-play-circle" />YouTube</button>
        <button class="min-h-11" :aria-current="section === 'jellyfin' ? 'page' : undefined" @click="section = 'jellyfin'"><UIcon name="i-heroicons-film" />Jellyfin</button>
      </nav>
      <UInput v-model="search" icon="i-heroicons-magnifying-glass" :placeholder="section === 'jellyfin' ? 'Find a series' : 'Search your library'" aria-label="Search preview" class="w-full sm:w-80" />
    </div>
    <div v-else class="mb-4 flex items-center gap-2"><UButton :to="base" variant="ghost" icon="i-heroicons-arrow-left" class="min-h-11">Back to library</UButton><h1 class="truncate text-xl font-bold">{{ sourceTitle }}</h1></div>
    <ViewingStatus v-if="status" :status="status" class="mb-4" />
    <p v-if="error" role="alert" class="mb-3 text-red-600">{{ error }} <UButton variant="soft" @click="isSource ? loadSource() : loadLibrary()">Retry</UButton></p>
    <p v-if="loading && !(isSource ? source : library)" role="status">Loading preview…</p>

    <template v-if="isSource">
      <UInput v-model="search" icon="i-heroicons-magnifying-glass" placeholder="Search all videos in this source" aria-label="Search source videos" class="mb-4 w-full" />
      <div v-if="source?.videos.length" class="zt-video-grid">
        <article v-for="video in source.videos" :key="video.videoId" class="zt-video-card">
          <div class="zt-video-card__media"><MediaArtwork :src="video.videoThumbnail" :title="video.videoTitle" /><span v-if="video.duration" class="zt-duration">{{ formatDuration(video.duration) }}</span></div>
          <p class="mt-2 font-semibold leading-5 line-clamp-2">{{ video.videoTitle }}</p><p class="text-sm text-[var(--zt-muted)]">{{ video.channelTitle }}</p>
          <p v-if="video.requiresClaim" class="text-xs">{{ source.unlockedVideoIds?.includes(video.videoId) ? 'Unlocked' : 'Requires 1 unlock credit' }}</p>
          <p v-if="videoUnavailable(video, source)" class="text-xs text-amber-700">{{ videoUnavailable(video, source) }}</p>
        </article>
      </div>
      <p v-else-if="source && !loading" class="py-6 text-[var(--zt-muted)]">No synced videos match this selection.</p>
      <UButton v-if="source?.nextPage != null" variant="soft" class="mt-4 min-h-11" :loading="loading" @click="loadSource(true)">Load more videos</UButton>
    </template>
    <template v-else-if="section === 'jellyfin'">
      <h2 class="zt-section-title">Choose a series</h2>
      <div class="zt-video-grid"><NuxtLink v-for="item in jellyfinPlaylists.filter(p => p.playlistTitle.toLowerCase().includes(search.toLowerCase()))" :key="item.id" :to="destination('playlist', item.id)" class="zt-video-card"><div class="zt-video-card__media"><MediaArtwork :src="item.playlistThumbnail" :title="item.playlistTitle" kind="playlist" /><span class="zt-duration">View episodes</span></div><p class="mt-2 font-semibold">{{ item.playlistTitle }}</p></NuxtLink></div>
      <p v-if="library && !jellyfinPlaylists.length" class="py-6 text-[var(--zt-muted)]">No imported series available.</p>
    </template>
    <template v-else>
      <div v-if="tags.length" class="mb-4 flex gap-2 overflow-x-auto" aria-label="Content tags"><UButton :variant="tag ? 'ghost' : 'soft'" class="min-h-11" @click="tag = ''">All</UButton><UButton v-for="item in tags" :key="item" :variant="tag === item ? 'soft' : 'ghost'" class="min-h-11" @click="tag = item">{{ item }}</UButton></div>
      <p v-if="searching" role="status">Searching your library…</p>
      <section v-if="!search && !tag && library?.continueWatching.length" class="mb-6"><h2 class="zt-section-title">Continue Watching</h2><div class="zt-video-grid"><article v-for="video in library.continueWatching.filter(visible)" :key="video.videoId" class="zt-video-card"><div class="zt-video-card__media"><MediaArtwork :src="video.videoThumbnail" :title="video.videoTitle" /></div><p class="mt-2 font-semibold">{{ video.videoTitle }}</p></article></div></section>
      <section v-if="!search && !tag && library?.recommendations.length" class="mb-6"><h2 class="zt-section-title">New for You</h2><div class="zt-video-grid"><article v-for="video in library.recommendations.filter(visible)" :key="video.videoId" class="zt-video-card"><div class="zt-video-card__media"><MediaArtwork :src="video.videoThumbnail" :title="video.videoTitle" /></div><p class="mt-2 font-semibold">{{ video.videoTitle }}</p></article></div></section>
      <section v-if="!search && !tag && library?.favorites.length" class="mb-6"><h2 class="zt-section-title">Favorites</h2><div class="zt-video-grid"><article v-for="video in library.favorites.filter(visible)" :key="video.videoId" class="zt-video-card"><div class="zt-video-card__media"><MediaArtwork :src="video.videoThumbnail" :title="video.videoTitle" /></div><p class="mt-2 font-semibold">{{ video.videoTitle }}</p></article></div></section>
      <section v-if="channels.length" class="mb-6"><h2 class="zt-section-title">Channels</h2><div class="zt-channel-grid"><NuxtLink v-for="item in channels" :key="item.id" :to="destination('channel', item.id)" class="zt-channel-link"><UAvatar :src="item.channelThumbnail || undefined" :alt="item.channelTitle" class="h-12 w-12 shrink-0" /><p class="truncate text-sm font-medium">{{ item.channelTitle }}</p></NuxtLink></div></section>
      <section v-if="playlists.length" class="mb-6"><h2 class="zt-section-title">Playlists</h2><div class="zt-video-grid"><NuxtLink v-for="item in playlists" :key="item.id" :to="destination('playlist', item.id)" class="zt-video-card"><div class="zt-video-card__media"><MediaArtwork :src="item.playlistThumbnail" :title="item.playlistTitle" kind="playlist" /></div><p class="mt-2 font-semibold">{{ item.playlistTitle }}</p></NuxtLink></div></section>
      <section v-if="filteredVideos.length" class="mb-6"><h2 class="zt-section-title">Videos</h2><div class="zt-video-grid"><article v-for="video in filteredVideos" :key="video.videoId" class="zt-video-card"><div class="zt-video-card__media"><MediaArtwork :src="video.videoThumbnail" :title="video.videoTitle" /><span v-if="video.duration" class="zt-duration">{{ formatDuration(video.duration) }}</span></div><p class="mt-2 font-semibold leading-5 line-clamp-2">{{ video.videoTitle }}</p><p class="text-sm text-[var(--zt-muted)]">{{ video.channelTitle }}</p><p v-if="videoUnavailable(video, library)" class="text-xs text-amber-700">{{ videoUnavailable(video, library) }}</p></article></div><UButton v-if="results?.nextPage != null" variant="soft" class="mt-4 min-h-11" :loading="searching" @click="searchVideos(true)">Load more results</UButton></section>
      <p v-if="library && !channels.length && !playlists.length && !filteredVideos.length && !searching" class="py-8 text-center text-[var(--zt-muted)]">No content matches this selection.</p>
    </template>
  </div>
</template>
