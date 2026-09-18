import { onBeforeUnmount, onMounted, ref } from 'vue'
import { apiFetch } from '../../src/api'
import type { ViewingStatus, WatchTimeStatus, ViewingPolicy } from '../../src/domain'

export function useViewingStatus(initial: () => ViewingStatus | null) {
  const status = ref<ViewingStatus | null>(initial())
  const error = ref('')
  const refreshing = ref(false)
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  async function refresh() {
    if (refreshing.value || disposed) return
    refreshing.value = true
    try {
      const result = await apiFetch<WatchTimeStatus & { policy: ViewingPolicy }>('/api/child/watch-time')
      if (!disposed) { status.value = { watchTime: { restricted: result.restricted, exempt: result.exempt, cartoon: result.cartoon, pools: result.pools }, policy: result.policy }; error.value = '' }
    } catch {
      if (!disposed) error.value = 'Unable to check viewing time. Try again.'
    } finally {
      refreshing.value = false
      if (!disposed) {
        clearTimeout(timer)
        const expiry = status.value?.policy.breakUntil
        const untilBreakEnds = expiry ? Date.parse(expiry) - Date.now() : Infinity
        // Recheck elapsed breaks promptly, and other Admin changes within 30s.
        const delay = untilBreakEnds > 0 ? Math.min(30_000, untilBreakEnds + 250) : 30_000
        timer = setTimeout(() => { if (!document.hidden) void refresh() }, delay)
      }
    }
  }
  const visible = () => { if (!document.hidden) void refresh() }
  onMounted(() => { document.addEventListener('visibilitychange', visible); void refresh() })
  onBeforeUnmount(() => { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visible) })
  return { status, error, refreshing, refresh }
}
