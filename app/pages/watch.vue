<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AccountMenu from '../components/AccountMenu.vue'
import MediaArtwork from '../components/MediaArtwork.vue'
import { useWatchPlayback } from '../composables/use-watch-playback'
import { useFavorites } from '../composables/use-favorites'
import { formatDuration } from '../../src/video-ui'
import { apiFetch, useApi } from '../../src/api'

const route = useRoute()
const router = useRouter()
const videoId = route.query.v as string
const playlistParam = route.query.playlist as string | undefined
const channelParam = route.query.channel as string | undefined


type RelatedVideo = {
  season?: string | null
  videoId: string
  videoTitle: string
  videoThumbnail: string
  duration: number | null
  channelTitle: string | null
}

type RelatedSource = {
  channel?: { title: string }
  playlist?: { title: string; curated?: boolean }
  videos: RelatedVideo[]
  nextPage: number | null
}

const relatedSourceUrl = playlistParam
  ? `/api/child/playlist/${playlistParam}/videos`
  : channelParam
    ? `/api/child/channel/${channelParam}/videos`
    : null
const relatedData = relatedSourceUrl
  ? useApi<RelatedSource>(relatedSourceUrl)
  : { data: ref<RelatedSource | null>(null) }
const relatedVideos = computed(() => relatedData.data.value?.videos ?? [])
const relatedTitle = computed(() => relatedData.data.value?.playlist?.title ?? relatedData.data.value?.channel?.title ?? 'More videos')
const relatedKind = playlistParam ? 'Playlist' : 'Channel'
const backTarget = route.query.pool ? '/cartoon-pool' : playlistParam
  ? `/browse/playlist/${playlistParam}`
  : channelParam
    ? `/browse/channel/${channelParam}`
    : '/browse'

function watchLocation(relatedVideoId: string) {
  return {
    path: '/watch',
    query: {
      v: relatedVideoId,
      ...(playlistParam ? { playlist: playlistParam } : {}),
      ...(channelParam ? { channel: channelParam } : {}),
    },
  }
}

const { favorite, playbackError, playbackStopped, remainingSeconds, usageBucket, timePoolName, videoTitle, videoDescription, channelTitle, warning, formatRemaining, claimPrompt, claimPending, claimError, confirmClaim } = useWatchPlayback(videoId)
const { error: favoriteError, pending: favoritePending, toggle: toggleFavorite } = useFavorites(() => favorite.value ? [videoId] : [], ids => { favorite.value = ids.includes(videoId) })
const relatedExpanded = ref(false)
const isCurated = computed(() => Boolean(relatedData.data.value?.playlist?.curated))
const nextEpisode = computed(() => {
  const index = relatedVideos.value.findIndex(v => v.videoId === videoId)
  return index >= 0 ? relatedVideos.value[index + 1] : undefined
})
const loadingMore = ref(false)
const relatedError = ref('')
async function loadMoreRelated() {
  const current = relatedData.data.value
  if (!current || current.nextPage == null || loadingMore.value || !relatedSourceUrl) return
  loadingMore.value = true
  relatedError.value = ''
  try {
    const result = await apiFetch<RelatedSource>(`${relatedSourceUrl}?page=${current.nextPage}`)
    relatedData.data.value = { ...result, videos: [...current.videos, ...result.videos] }
  } catch { relatedError.value = 'Unable to load more videos. Please try again.' }
  finally { loadingMore.value = false }
}
function reload() { window.location.reload() }

</script>

<template>
  <div class="zt-app-shell min-h-screen">
    <UModal :open="Boolean(claimPrompt)" :dismissible="!claimPending" :close="!claimPending" title="Unlock this episode?" description="Use one credit to unlock this episode for future viewing." @update:open="!$event && router.replace('/cartoon-pool')">
      <template #body>
        <template v-if="claimPrompt">
          <p class="text-lg font-semibold">{{ claimPrompt.videoTitle }}</p>
          <p class="mt-2">{{ claimPrompt.remaining }} of {{ claimPrompt.totalCredits ?? claimPrompt.dailyLimit }} unlock credits left today.</p>
          <p v-if="claimPrompt.remaining" class="mt-2 text-sm text-[var(--zt-muted)]">Unlocking uses one credit today. This episode stays unlocked: watch it again another day without using another credit. All viewing uses its time pool. Unused credits expire at midnight.</p>
          <p v-else class="mt-2" role="status">Today’s unlock credits are used up. You can watch unlocked episodes or unlock a new one tomorrow.</p>
          <p v-if="claimError" role="alert" class="mt-3 text-sm text-red-600">{{ claimError }}</p>
        </template>
      </template>
      <template #footer>
        <UButton color="neutral" variant="soft" class="min-h-11" :disabled="claimPending" @click="router.replace('/cartoon-pool')">Back to Jellyfin</UButton>
        <UButton v-if="claimPrompt?.remaining" class="min-h-11" :loading="claimPending" @click="confirmClaim">Unlock episode</UButton>
      </template>
    </UModal>
    <header class="zt-app-header sticky top-0 z-40 flex min-h-14 items-center justify-between border-b px-3 backdrop-blur sm:px-5">
      <NuxtLink :to="backTarget" class="zt-icon-link flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-medium">
        <UIcon name="i-heroicons-arrow-left" class="h-5 w-5" />
        Back
      </NuxtLink>
      <span class="zt-brand flex items-center gap-2 text-lg font-bold"><span class="zt-brand-mark flex h-7 w-9 items-center justify-center rounded-md text-white"><UIcon name="i-heroicons-play-solid" class="h-4 w-4" /></span>ZTube</span>
      <div class="flex items-center gap-1">
        <AccountMenu />
      </div>
    </header>

    <div class="zt-watch-shell">
      <div class="zt-watch-layout" :class="{ 'zt-watch-layout--solo': !relatedVideos.length }">
        <main class="min-w-0">
          <div class="zt-watch-player">
            <div v-if="playbackStopped" class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-white" role="status">
              <p>{{ remainingSeconds === 0 ? 'Today’s viewing allowance is used up.' : 'Playback has stopped.' }}</p>
              <p class="max-w-xl text-sm text-gray-300">Return to Browse to check when you can watch again.</p>
              <NuxtLink to="/browse" class="flex min-h-11 items-center rounded-lg bg-white px-4 font-medium text-gray-900">Back to Browse</NuxtLink>
            </div>
            <div v-else-if="!playbackError" id="youtube-player" class="h-full w-full"></div>
            <div v-else class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-white" role="alert">
              <UIcon name="i-heroicons-exclamation-triangle" class="h-8 w-8 text-amber-400" />
              <p class="max-w-xl font-medium">{{ playbackError }}</p>
              <p class="max-w-xl text-sm text-gray-300">Try again, or return to Browse to check your viewing time.</p><UButton color="neutral" @click="reload">Try again</UButton>
            </div>
          </div>

          <section v-if="videoTitle" class="zt-surface mt-3 rounded-xl border p-3" aria-label="Video details">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0"><h1 class="text-lg font-semibold leading-6">{{ videoTitle }}</h1><p class="mt-1 text-sm text-[var(--zt-muted)]">{{ channelTitle }}</p></div>
              <UButton :icon="favorite ? 'i-heroicons-star-solid' : 'i-heroicons-star'" :variant="favorite ? 'solid' : 'soft'" :loading="favoritePending.has(videoId)" :aria-pressed="favorite" :aria-label="favorite ? 'Remove from Favorites' : 'Add to Favorites'" class="shrink-0" @click="toggleFavorite(videoId)" />
            </div>
            <p v-if="favoriteError" role="alert" class="mt-2 text-sm text-red-600">{{ favoriteError }}</p>
            <p v-if="remainingSeconds !== null" class="mt-2 text-sm font-medium tabular-nums">{{ formatRemaining(remainingSeconds) }} {{ timePoolName || (usageBucket === 'cartoon' ? 'Cartoon Time' : usageBucket === 'exempt' ? 'Safety Cap' : 'Daily Allowance') }} remaining</p>
            <p v-if="warning" class="mt-1 text-sm text-amber-700 dark:text-amber-300" role="status">{{ warning }}</p>
            <details v-if="videoDescription" class="mt-1 text-sm"><summary class="flex min-h-11 cursor-pointer items-center font-medium text-[var(--zt-blue)]">Description</summary><p class="whitespace-pre-wrap text-[var(--zt-muted)]">{{ videoDescription }}</p></details>
          </section>
          <div v-if="isCurated" class="mt-3 flex flex-wrap items-center gap-2">
            <UButton v-if="nextEpisode" :to="watchLocation(nextEpisode.videoId)" class="min-h-11">Next episode · {{ nextEpisode.videoTitle }}</UButton>
            <UButton :to="`/browse/playlist/${playlistParam}`" variant="soft" class="min-h-11">Choose season / episode</UButton>
          </div>
          <UButton v-if="relatedVideos.length" variant="soft" class="mt-3 xl:hidden" :aria-expanded="relatedExpanded" aria-controls="related-videos" @click="relatedExpanded = !relatedExpanded">{{ relatedExpanded ? 'Hide' : 'Show' }} {{ relatedKind.toLowerCase() }} videos</UButton>
        </main>

        <aside v-if="relatedVideos.length" id="related-videos" class="zt-watch-related zt-panel" :class="{ 'zt-watch-related--collapsed': !relatedExpanded }" :aria-label="`${relatedKind} videos`">
          <div class="border-b border-gray-200 px-4 py-3">
            <p class="text-xs font-semibold uppercase tracking-wide text-[#606060]">{{ relatedKind }}</p>
            <h2 class="truncate font-semibold">{{ relatedTitle }}</h2>
            <p class="text-sm text-[#606060]">{{ relatedVideos.length }}{{ relatedData.data.value?.nextPage != null ? '+' : '' }} videos</p>
          </div>
          <div class="zt-watch-related__list">
            <NuxtLink
              v-for="(video, index) in relatedVideos"
              :key="video.videoId"
              :to="watchLocation(video.videoId)"
              class="flex min-h-24 gap-3 border-b border-gray-100 p-3 transition hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#065fd4]"
              :class="{ 'bg-[#e8f0fe]': video.videoId === videoId }"
              :aria-current="video.videoId === videoId ? 'true' : undefined"
            >
              <span class="w-5 shrink-0 text-center text-sm text-[#606060]">{{ Number(index) + 1 }}</span>
              <div class="relative shrink-0">
                <MediaArtwork :src="video.videoThumbnail" :title="video.videoTitle" compact class="h-16 w-28 rounded-lg lg:h-14 lg:w-24" />
                <span v-if="video.duration" class="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 text-xs text-white">
                  {{ formatDuration(video.duration) }}
                </span>
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm line-clamp-2">{{ video.videoTitle }}</p>
                <p class="mt-1 truncate text-xs text-[#606060]">{{ video.season || video.channelTitle }}</p>
              </div>
            </NuxtLink>
          </div>
          <p v-if="relatedError" role="alert" class="p-3 text-sm">{{ relatedError }}</p>
          <UButton v-if="relatedData.data.value?.nextPage != null" variant="ghost" class="m-3" :loading="loadingMore" @click="loadMoreRelated">Load more videos</UButton>
        </aside>
      </div>
    </div>
  </div>
</template>
