<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { apiFetch } from '../../src/api'
import type { BrowseResponse, CartoonPoolResponse } from '../../src/domain'
import LibraryNav from '../components/LibraryNav.vue'
import MediaArtwork from '../components/MediaArtwork.vue'
import VideoCard from '../components/VideoCard.vue'

const data = ref<CartoonPoolResponse | null>(null)
const query = ref('')
const library = ref<BrowseResponse | null>(null)
const series = computed(() => (library.value?.playlists ?? []).filter(p => p.playlistId?.startsWith('pl:jf:')))
const filteredSeries = computed(() => series.value.filter(p => p.playlistTitle.toLowerCase().includes(query.value.trim().toLowerCase())))
const showUnlocked = ref(false)
const showEpisodes = ref(false)
const loading = ref(false)
const error = ref('')
const loadedViewKey = ref<string | null>(null)
const viewKey = computed(() => `${showUnlocked.value ? 'unlocked' : 'series'}:${query.value.trim()}`)
const resultsCurrent = computed(() => loadedViewKey.value === viewKey.value)
const visibleEpisodes = computed(() => resultsCurrent.value ? (data.value?.videos ?? []).filter(v => v.videoId.startsWith('jf:')) : [])
let generation = 0
let debounce: ReturnType<typeof setTimeout> | undefined
let disposed = false
async function load(more = false) {
  if (more && (loading.value || data.value?.nextPage == null)) return
  const current = ++generation
  const requestedViewKey = viewKey.value
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({ source: 'jellyfin', unlocked: showUnlocked.value ? '1' : '0', q: query.value.trim(), page: String(more ? data.value!.nextPage : 0) })
    const result = await apiFetch<CartoonPoolResponse>(`/api/child/cartoon-pool?${params}`)
    if (!disposed && current === generation) {
      data.value = more && data.value ? {
        ...result,
        videos: [...data.value.videos, ...result.videos],
        unlockedVideoIds: [...new Set([...(data.value.unlockedVideoIds ?? []), ...(result.unlockedVideoIds ?? [])])],
      } : result
      loadedViewKey.value = requestedViewKey
    }
  } catch (cause) { if (!disposed && current === generation) error.value = cause instanceof Error ? cause.message : 'Unable to load Cartoon Pool' }
  finally { if (!disposed && current === generation) loading.value = false }
}
watch([query, showUnlocked], () => {
  generation++
  loadedViewKey.value = null
  clearTimeout(debounce)
  debounce = setTimeout(() => { void load() }, 250)
})
function refreshOnFocus() { void load() }
onMounted(() => { void apiFetch<BrowseResponse>('/api/child/browse').then(result => { if (!disposed) library.value = result }).catch(() => {}); void load(); window.addEventListener('focus', refreshOnFocus) })
onBeforeUnmount(() => { disposed = true; clearTimeout(debounce); window.removeEventListener('focus', refreshOnFocus) })
const watchLocation = (videoId: string) => ({ path: '/watch', query: { v: videoId, pool: '1' } })
</script>

<template>
  <div class="zt-page">
    <h1 class="sr-only">Jellyfin</h1><header class="zt-library-toolbar"><LibraryNav /><UInput v-model="query" aria-label="Search Cartoon Pool" placeholder="Find a series or episode" icon="i-heroicons-magnifying-glass" class="w-full sm:w-80" /></header>
    <div class="zt-library-note" v-if="data" role="status">
      <span class="font-semibold text-[var(--zt-text)]">{{ data.remaining }} of {{ data.totalCredits ?? data.dailyLimit }} unlock credits left today</span>
      <span v-for="pool in data.timePools" :key="pool.id">{{ Math.ceil(pool.remainingSeconds / 60) }} min {{ pool.name }} left</span>
      <span v-if="!data.timePools && data.cartoonTime">{{ Math.ceil(data.cartoonTime.remainingSeconds / 60) }} min left</span>
    </div>

    <div v-if="error" class="mb-3 flex items-center gap-3" role="alert"><span>{{ error }}</span><UButton variant="soft" @click="load()">Retry</UButton></div>
    <div class="mb-4 flex gap-2" aria-label="Jellyfin collection"><UButton :variant="showUnlocked ? 'ghost' : 'soft'" @click="showUnlocked = false">Series</UButton><UButton :variant="showUnlocked ? 'soft' : 'ghost'" @click="showUnlocked = true">Unlocked</UButton></div>
    <section v-if="filteredSeries.length && !showUnlocked" class="mb-6" aria-label="Cartoon series">
      <h2 class="zt-section-title">Choose a series</h2>
      <div class="zt-jellyfin-grid">
        <NuxtLink v-for="item in filteredSeries" :key="item.id" :to="`/browse/playlist/${item.id}`" class="zt-video-card">
          <div class="zt-video-card__media"><MediaArtwork :src="item.playlistThumbnail" :title="item.playlistTitle" kind="playlist" /><span class="zt-duration">View episodes</span></div>
          <h3 class="mt-2 line-clamp-2 font-semibold leading-5" :title="item.playlistTitle">{{ item.playlistTitle }}</h3>
          <template v-for="hint in (library?.seriesNavigation ?? []).filter(hint => hint.playlistId === item.id)" :key="hint.playlistId">
            <p class="mt-1 truncate text-xs text-[var(--zt-muted)]" :title="`Last unlocked: ${hint.previousTitle}`">Last unlocked: {{ hint.previousTitle }}</p>
            <p class="mt-1 line-clamp-2 text-xs text-[var(--zt-blue)]" :title="hint.nextTitle ? `Next: ${hint.nextTitle}` : undefined">{{ hint.nextTitle ? `Next: ${hint.nextTitle}` : 'Last available episode reached' }}</p>
          </template>
        </NuxtLink>
      </div>
      <UButton class="mt-4 min-h-11" variant="ghost" color="neutral" :aria-expanded="showEpisodes" @click="showEpisodes = !showEpisodes">{{ showEpisodes ? 'Hide all episodes' : 'Browse all episodes' }}</UButton>
    </section>
    <p v-if="loading && !data" role="status">Loading Jellyfin library…</p>
    <section v-if="data && (showUnlocked || query || !series.length || showEpisodes)" aria-label="Choose an episode">
      <h2 class="zt-section-title">{{ showUnlocked ? 'Unlocked episodes' : 'Choose an episode' }}</h2>
      <p v-if="!resultsCurrent" class="py-5 text-[var(--zt-muted)]" role="status">Loading episodes…</p>
      <p v-else-if="!visibleEpisodes.length && !loading" class="py-5 text-[var(--zt-muted)]">{{ showUnlocked ? 'No unlocked episodes here yet. Choose a series to unlock your first one.' : query ? 'No matching episodes.' : 'No series here yet. Ask your Admin to import one from Jellyfin.' }}</p>
      <div v-if="resultsCurrent" class="zt-jellyfin-grid">
        <div v-for="video in visibleEpisodes" :key="video.videoId">
          <VideoCard :video="video" :to="watchLocation(video.videoId)" />
          <p class="mt-1 text-xs text-[var(--zt-muted)]">{{ data.unlockedVideoIds?.includes(video.videoId) ? 'Unlocked · No credit needed' : data.remaining ? 'Unlock with 1 credit' : 'More credits tomorrow' }}</p>
        </div>
      </div>
      <UButton v-if="resultsCurrent && data.nextPage !== null" class="mt-4 min-h-11" variant="soft" :loading="loading" @click="load(true)">Load more episodes</UButton>
    </section>
  </div>
</template>

<style scoped>
.zt-jellyfin-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.25rem .75rem;
  font-size: .875rem;
}
.zt-jellyfin-grid > * { min-width: 0; }
@media (min-width: 640px) {
  .zt-jellyfin-grid {
    /* Empty tracks keep a small collection as compact as a full library. */
    grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
  }
}
</style>
