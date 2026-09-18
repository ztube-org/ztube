<script setup lang="ts">
import { ref } from 'vue'
import { apiFetch } from '../../src/api'
import type { TimePoolsResponse, TimePoolStatus } from '../../src/domain'
const props = defineProps<{ childId: number }>()
const emit = defineEmits<{ loaded: [data: TimePoolsResponse] }>()
const data = ref<TimePoolsResponse | null>(null)
const drafts = ref<TimePoolStatus[]>([])
const error = ref('')
const notice = ref('')
const busy = ref(false)
const newName = ref('')
async function refresh() {
  const result = await apiFetch<TimePoolsResponse>(`/api/admin/children/${props.childId}/time-pools`)
  const previous = data.value
  drafts.value = result.pools.map(pool => {
    const draft = drafts.value.find(item => item.id === pool.id)
    const saved = previous?.pools.find(item => item.id === pool.id)
    const edited = draft && saved && ['name', 'weekdayMinutes', 'weekendMinutes', 'requiresClaim'].some(key => draft[key as keyof TimePoolStatus] !== saved[key as keyof TimePoolStatus])
    return edited ? { ...pool, name: draft.name, weekdayMinutes: draft.weekdayMinutes, weekendMinutes: draft.weekendMinutes, requiresClaim: draft.requiresClaim } : { ...pool }
  })
  data.value = result
  emit('loaded', result)
}
async function act(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await action(); await refresh() } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Unable to save time pools' }
  finally { busy.value = false }
}
async function save(pool: TimePoolStatus) {
  await apiFetch(`/api/admin/children/${props.childId}/time-pools/${pool.id}`, { method: 'PUT', body: pool })
  notice.value = `${pool.name} saved.`
}
async function add() {
  await apiFetch(`/api/admin/children/${props.childId}/time-pools`, { method: 'POST', body: { name: newName.value, weekdayMinutes: 30, weekendMinutes: 30, requiresClaim: false } })
  newName.value = ''; notice.value = 'Time pool created.'
}
async function extend(pool: TimePoolStatus, minutes: number) {
  await apiFetch(`/api/admin/children/${props.childId}/time-pools/${pool.id}/extensions`, { method: 'POST', body: { minutes } })
  notice.value = `${minutes} minutes added to ${pool.name} for today.`
}
void act(async () => {})
</script>

<template>
  <section class="mb-5 space-y-3" aria-label="Time pools">
    <div class="flex flex-wrap items-center justify-between gap-2"><div><h2 class="text-xl font-semibold">Time pools</h2><p class="text-sm text-[var(--zt-muted)]">Shared by content in the same pool, independent for each Child. All pools reset at local midnight.</p></div><UButton variant="soft" :loading="busy" @click="act(async () => {})">Refresh pools</UButton></div>
    <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p><p v-if="notice" role="status" class="text-sm">{{ notice }}</p>
    <div class="grid gap-3 md:grid-cols-3">
      <form v-for="pool in drafts" :key="pool.id" :aria-label="`${pool.name} time pool`" class="zt-panel space-y-3 rounded-xl border p-3" @submit.prevent="act(() => save(pool))">
        <h3 class="text-lg font-semibold">{{ pool.name }}</h3>
        <progress :value="pool.usedSeconds" :max="Math.max(1, pool.usedSeconds + pool.remainingSeconds)" :aria-label="`${pool.name} time used today`" class="h-2 w-full accent-[var(--zt-blue)]" />
        <p class="text-sm tabular-nums">Today: {{ Math.floor(pool.usedSeconds / 60) }} min used · {{ Math.ceil(pool.remainingSeconds / 60) }} min left<span v-if="pool.extensionMinutes"> · +{{ pool.extensionMinutes }} min today</span></p>

        <div><p class="mb-1 text-xs text-[var(--zt-muted)]">Add time for today only</p><div class="flex gap-1"><UButton v-for="minutes in [15, 30, 60]" :key="minutes" variant="soft" :disabled="busy" :aria-label="`Add ${minutes} minutes to ${pool.name} today`" class="min-h-11 flex-1 justify-center px-1" @click="act(() => extend(pool, minutes))">+{{ minutes }} min</UButton></div></div>
        <details class="border-t border-[var(--zt-border)] pt-1"><summary class="min-h-11 cursor-pointer content-center text-sm font-medium">Edit daily limits</summary><div class="space-y-3 pt-2">
        <label class="block text-sm font-medium">Pool name<input v-model="pool.name" required maxlength="40" :disabled="busy" class="zt-surface mt-1 min-h-11 w-full rounded-lg border px-3" /></label>
        <div class="grid grid-cols-2 gap-2">
          <label class="text-sm">Weekday minutes<input v-model.number="pool.weekdayMinutes" type="number" min="0" max="1440" step="1" required :disabled="busy" class="zt-surface mt-1 min-h-11 w-full rounded-lg border px-3" /></label>
          <label class="text-sm">Weekend minutes<input v-model.number="pool.weekendMinutes" type="number" min="0" max="1440" step="1" required :disabled="busy" class="zt-surface mt-1 min-h-11 w-full rounded-lg border px-3" /></label>
        </div>
        <label class="flex min-h-11 items-center gap-2 text-sm"><input v-model="pool.requiresClaim" type="checkbox" :disabled="busy" class="h-5 w-5 min-h-5 min-w-5 shrink-0 accent-[var(--zt-blue)]" />Unlock required before first play</label>
        <UButton type="submit" :disabled="busy" class="min-h-11 w-full justify-center">Save pool</UButton>
        </div></details>
      </form>
    </div>
    <details><summary class="min-h-11 cursor-pointer content-center text-sm text-[var(--zt-muted)]">Add another time pool</summary><form class="flex gap-2" @submit.prevent="act(add)"><UInput v-model="newName" placeholder="New pool name" aria-label="New pool name" required maxlength="40" :disabled="busy" class="min-h-11" /><UButton type="submit" :disabled="busy || !newName.trim()" class="min-h-11">Add time pool</UButton></form></details>
  </section>
</template>

<style scoped>
progress { appearance: none; overflow: hidden; border: 0; border-radius: 999px; background: var(--zt-border); }
progress::-webkit-progress-bar { background: var(--zt-border); border-radius: 999px; }
progress::-webkit-progress-value { background: var(--zt-blue); border-radius: 999px; }
progress::-moz-progress-bar { background: var(--zt-blue); border-radius: 999px; }
input[type="checkbox"] { min-width: 1.25rem; min-height: 1.25rem; }
</style>
