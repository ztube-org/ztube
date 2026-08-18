import { computed, onMounted, ref } from 'vue'
import { apiFetch } from '../../src/api'
import { contentStatus } from '../../src/content-rule-ui'
import type { ApprovedSourceKind, ApprovedVideo, SourceVideosResponse } from '../../src/domain'

export function useSourceVideos(kind: ApprovedSourceKind, sourceId: string) {
  const data = ref<SourceVideosResponse | null>(null)
  const loadError = ref('')
  const loadingMore = ref(false)
  const search = ref('')
  const filteredVideos = computed(() => {
    const query = search.value.trim().toLowerCase()
    return (data.value?.videos ?? []).filter(video => !query || `${video.videoTitle} ${video.channelTitle ?? ''}`.toLowerCase().includes(query))
  })
  const source = computed(() => data.value?.[kind])
  const blocked = (video: ApprovedVideo) => Boolean(data.value?.policy.blocked || (data.value?.watchTime && contentStatus(video.contentRule, data.value.watchTime).locked))

  onMounted(async () => {
    try {
      data.value = await apiFetch<SourceVideosResponse>(`/api/child/${kind}/${sourceId}/videos`)
    } catch (value) {
      loadError.value = value instanceof Error ? value.message : `Unable to load cached ${kind} videos`
    }
  })

  async function loadMore() {
    if (!data.value || data.value.nextPage === null) return
    loadingMore.value = true
    try {
      const result = await apiFetch<SourceVideosResponse>(`/api/child/${kind}/${sourceId}/videos?page=${data.value.nextPage}`)
      data.value.videos.push(...result.videos)
      data.value.favoriteVideoIds = [...new Set([...data.value.favoriteVideoIds, ...result.favoriteVideoIds])]
      data.value.nextPage = result.nextPage
    } finally { loadingMore.value = false }
  }

  async function toggleFavorite(videoId: string) {
    if (!data.value) return
    const favorites = data.value.favoriteVideoIds
    if (favorites.includes(videoId)) {
      await apiFetch(`/api/child/favorites/${encodeURIComponent(videoId)}`, { method: 'DELETE' })
      data.value.favoriteVideoIds = favorites.filter(id => id !== videoId)
    } else {
      await apiFetch('/api/child/favorites', { method: 'POST', body: { videoId } })
      data.value.favoriteVideoIds = [...favorites, videoId]
    }
  }

  return { data, source, loadError, loadingMore, search, filteredVideos, blocked, loadMore, toggleFavorite }
}
