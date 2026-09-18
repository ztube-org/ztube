import { nextTick, onMounted } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useAuth } from '../../src/api'

// Memory only, bounded and cleared when the authenticated Child changes.
const entries = new Map<string, { state: unknown; scroll: number }>()
let owner: number | undefined
export function useBrowseMemory<T>(key: string, create: () => T): T {
  const id = useAuth().user.value?.id
  if (owner !== id) { entries.clear(); owner = id }
  if (!entries.has(key)) {
    if (entries.size >= 10) entries.delete(entries.keys().next().value!)
    entries.set(key, { state: create(), scroll: 0 })
  }
  const entry = entries.get(key)!
  onBeforeRouteLeave(() => { entry.scroll = window.scrollY })
  onMounted(async () => {
    await nextTick()
    window.scrollTo(0, entry.scroll)
  })
  return entry.state as T
}
