import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { apiFetch } from '../../src/api'
import { videoUnavailable } from '../../src/video-ui'
import type { ApprovedSourceKind, ApprovedVideo, SourceVideosResponse } from '../../src/domain'
import { useBrowseMemory } from './use-browse-memory'
import { useFavorites } from './use-favorites'
import { useViewingStatus } from './use-viewing-status'

export function useSourceVideos(kind: ApprovedSourceKind, sourceId: string) {
  const { data, search, loadedSearch, loadedPages } = useBrowseMemory(`${kind}:${sourceId}`, () => ({ data: ref<SourceVideosResponse | null>(null), search: ref(''), loadedSearch: ref(''), loadedPages: ref(0) }))
  const loadError = ref('')
  const loading = ref(false)
  const loadingMore = ref(false)
  const viewing = useViewingStatus(() => data.value)
  const favorite = useFavorites(() => data.value?.favoriteVideoIds ?? [], ids => { if (data.value) data.value.favoriteVideoIds = ids })
  const source = computed(() => data.value?.[kind])
  const blocked = (video: ApprovedVideo) => videoUnavailable(video, viewing.status.value ?? data.value)
  let request = 0
  let debounce: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const url = (page: number) => `/api/child/${kind}/${sourceId}/videos?${new URLSearchParams({ page: String(page), q: search.value.trim() })}`

  async function fetchPage(more = false) {
    if (more && (!data.value || loadedSearch.value !== search.value || data.value.nextPage === null || loadingMore.value || loading.value)) return
    const current = ++request
    const page = more ? data.value!.nextPage! : 0
    loadError.value = ''
    if (more) loadingMore.value = true
    else loading.value = true
    try {
      const result = await apiFetch<SourceVideosResponse>(url(page))
      if (disposed || current !== request) return
      loadedSearch.value = search.value
      loadedPages.value = page + 1
      data.value = more && data.value ? { ...result, videos: [...data.value.videos, ...result.videos], favoriteVideoIds: [...new Set([...data.value.favoriteVideoIds, ...result.favoriteVideoIds])], unlockedVideoIds: [...new Set([...(data.value.unlockedVideoIds ?? []), ...(result.unlockedVideoIds ?? [])])] } : result
    } catch (cause) {
      if (!disposed && current === request) loadError.value = cause instanceof Error ? cause.message : 'Unable to load videos'
    } finally {
      if (!disposed && current === request) { loading.value = false; loadingMore.value = false }
    }
  }
  watch(search, () => {
    clearTimeout(debounce)
    request++ // Invalidate responses immediately, before the debounce fires.
    loading.value = true
    debounce = setTimeout(() => { void fetchPage() }, 250)
  })
  onMounted(() => {
    if (!data.value || search.value !== loadedSearch.value) { void fetchPage(); return }
    const current = ++request
    const pages = Math.max(1, loadedPages.value)
    void Promise.all(Array.from({ length: pages }, (_, page) => apiFetch<SourceVideosResponse>(url(page)))).then(results => {
      if (!disposed && current === request) data.value = { ...results[0], nextPage: results.at(-1)!.nextPage, videos: results.flatMap(result => result.videos), favoriteVideoIds: [...new Set(results.flatMap(result => result.favoriteVideoIds))], unlockedVideoIds: [...new Set(results.flatMap(result => result.unlockedVideoIds ?? []))] }
    }).catch(() => { if (!disposed && current === request) loadError.value = 'Unable to refresh videos. Showing your previous list.' })
  })
  onBeforeUnmount(() => { disposed = true; clearTimeout(debounce) })
  return { data, source, loadError, loading, loadingMore, search, filteredVideos: computed(() => loadedSearch.value === search.value ? data.value?.videos ?? [] : []), blocked,
    canLoadMore: computed(() => loadedSearch.value === search.value && data.value?.nextPage != null),
    loadMore: () => fetchPage(true), refresh: () => fetchPage(), toggleFavorite: favorite.toggle, favoriteError: favorite.error, favoritePending: favorite.pending, viewing }
}
