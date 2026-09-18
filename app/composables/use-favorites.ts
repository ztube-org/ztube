import { ref } from 'vue'
import { apiFetch } from '../../src/api'

export function useFavorites(ids: () => string[], update: (ids: string[]) => void) {
  const pending = ref(new Set<string>())
  const error = ref('')
  async function toggle(videoId: string) {
    if (pending.value.has(videoId)) return false
    pending.value.add(videoId)
    error.value = ''
    const removing = ids().includes(videoId)
    try {
      await apiFetch(removing ? `/api/child/favorites/${encodeURIComponent(videoId)}` : '/api/child/favorites', {
        method: removing ? 'DELETE' : 'POST', body: removing ? undefined : { videoId },
      })
      update(removing ? ids().filter(id => id !== videoId) : [...new Set([...ids(), videoId])])
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Unable to update Favorites. Please try again.'
      return false
    } finally { pending.value.delete(videoId) }
  }
  return { pending, error, toggle }
}
