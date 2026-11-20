<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { apiFetch } from '../../src/api'
import type { BrowseResponse, CartoonPoolResponse } from '../../src/domain'
import LibraryNav from '../components/LibraryNav.vue'
import MediaArtwork from '../components/MediaArtwork.vue'
import TimePoolPill from '../components/TimePoolPill.vue'
import VideoCard from '../components/VideoCard.vue'

const data = ref<CartoonPoolResponse | null>(null)
const query = ref('')
const library = ref<BrowseResponse | null>(null)
const continuation = computed(() => (library.value?.continueWatching ?? []).filter(video => video.videoId.startsWith('jf:')))
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
    <h1 class="sr-only">Jellyfin</h1><header class="zt-library-toolbar"><LibraryNav /><UInput :ui="{ base: 'min-h-11' }" v-model="query" aria-label="Search Cartoon Pool" placeholder="Find a series or episode" icon="i-heroicons-magnifying-glass" class="w-full sm:w-80" /></header>
    <div v-if="data" class="zt-pill-strip my-2" role="region" aria-label="Cartoon Pool balances" tabindex="0">
      <div class="flex shrink-0 items-center gap-2" role="status">
        <span class="zt-viewing-pill" :data-tone="data.remaining ? 'accent' : 'muted'">
          <UIcon name="i-heroicons-ticket" class="size-4 shrink-0" aria-hidden="true" />
          <span class="whitespace-nowrap">{{ data.remaining }} of {{ data.totalCredits ?? data.dailyLimit }} unlock credits left today</span>
        </span>
        <TimePoolPill v-for="pool in data.timePools" :key="pool.id" :pool="pool" />
        <TimePoolPill v-if="!data.timePools && data.cartoonTime" :pool="{ ...data.cartoonTime, name: undefined }" />
      </div>
    </div>

    <div v-if="error" class="mb-3 flex items-center gap-3" role="alert"><span>{{ error }}</span><UButton variant="soft" @click="load()">Retry</UButton></div>
    <section v-if="continuation.length" class="mb-5" aria-labelledby="jellyfin-continue-watching">
      <h2 id="jellyfin-continue-watching" class="zt-section-title">Continue Watching</h2>
      <div class="zt-video-shelf">
        <VideoCard v-for="video in continuation" :key="video.videoId" :video="video" :to="watchLocation(video.videoId)" />
      </div>
    </section>
    <div class="zt-segmented mb-4" role="group" aria-label="Jellyfin collection">
      <button type="button" :aria-pressed="!showUnlocked" @click="showUnlocked = false">Series</button>
      <button type="button" :aria-pressed="showUnlocked" @click="showUnlocked = true">Unlocked</button>
    </div>
    <section v-if="filteredSeries.length && !showUnlocked" class="mb-6" aria-label="Cartoon series">
      <h2 class="zt-section-title">Choose a series</h2>
      <div class="zt-jellyfin-grid">
        <NuxtLink v-for="item in filteredSeries" :key="item.id" :to="`/browse/playlist/${item.id}`" class="zt-video-card">
          <div class="zt-video-card__media"><MediaArtwork :src="item.playlistThumbnail" :title="item.playlistTitle" kind="playlist" /><span class="zt-duration">View episodes</span></div>
          <h3 class="mt-2 line-clamp-2 font-semibold leading-5" :title="item.playlistTitle">{{ item.playlistTitle }}</h3>
          <template v-for="hint in (library?.seriesNavigation ?? []).filter(hint => hint.playlistId === item.id)" :key="hint.playlistId">
            <p class="zt-meta-pill mt-1.5" data-tone="muted">
              <UIcon name="i-heroicons-lock-open" class="size-3.5 shrink-0" aria-hidden="true" />
              <span class="line-clamp-2">{{ `Last unlocked: ${hint.previousTitle}` }}</span>
            </p>
            <p class="zt-meta-pill mt-1" data-tone="accent">
              <UIcon name="i-heroicons-arrow-right" class="size-3.5 shrink-0" aria-hidden="true" />
              <span class="line-clamp-2">{{ hint.nextTitle ? `Next: ${hint.nextTitle}` : 'Last available episode reached' }}</span>
            </p>
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
          <p class="zt-meta-pill mt-1" :data-tone="data.unlockedVideoIds?.includes(video.videoId) ? 'accent' : 'muted'">{{ data.unlockedVideoIds?.includes(video.videoId) ? 'Unlocked · No credit needed' : data.remaining ? 'Unlock with 1 credit' : 'More credits tomorrow' }}</p>
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
