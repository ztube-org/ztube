<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { EpisodeClaimStatus, TimePoolStatus } from '../../src/domain'
import { apiFetch, ApiError, useApi } from '../../src/api'

const props = defineProps<{ childId: number; pools: TimePoolStatus[]; playlists: { id: number; playlistTitle: string; playlistId?: string }[] }>()
const visiblePlaylists = computed(() => props.playlists.filter(p => !p.playlistId?.startsWith('pl:') || p.playlistId.startsWith('pl:jf:')))
type Settings = { dailyLimit: number; timePoolId: string; playlistIds: number[] }
const { data, error: loadError, refresh } = useApi<Settings>(`/api/admin/children/${props.childId}/cartoon-pool`)
const creditPath = `/api/admin/children/${props.childId}/unlock-credits`
const { data: credits, error: creditLoadError, refresh: refreshCredits } = useApi<EpisodeClaimStatus>(creditPath)
const granting = ref(false)
const grantError = ref('')
const grantNotice = ref('')
let pendingGrant: { requestId: string; viewingDay: string } | null = null
async function grantCredit() {
  if (granting.value || !credits.value?.viewingDay) return
  granting.value = true
  grantError.value = ''; grantNotice.value = ''
  pendingGrant ??= { requestId: crypto.randomUUID(), viewingDay: credits.value.viewingDay }
  try {
    credits.value = await apiFetch<EpisodeClaimStatus>(creditPath, { method: 'POST', body: pendingGrant })
    pendingGrant = null
    grantNotice.value = '1 extra unlock credit granted for today.'
  } catch (cause) {
    grantError.value = cause instanceof Error ? cause.message : 'Unable to grant credit. Please retry.'
    if (cause instanceof ApiError && cause.status === 409) {
      pendingGrant = null
      await refreshCredits().catch(() => undefined)
    }
    // Other failures retain the operation ID: the server may have committed it
    // even if its response was lost. Retry must never grant another credit.
  } finally { granting.value = false }
}
function refreshCreditBalance() { if (!granting.value) void refreshCredits().catch(() => undefined) }
onMounted(() => window.addEventListener('focus', refreshCreditBalance))
onBeforeUnmount(() => window.removeEventListener('focus', refreshCreditBalance))
const dailyLimit = ref(1)
const timePoolId = ref('')
const playlistIds = ref<number[]>([])
const saving = ref(false)
const error = ref('')
const saved = ref(false)
watch(data, value => {
  if (value) { dailyLimit.value = value.dailyLimit; timePoolId.value = value.timePoolId; playlistIds.value = [...value.playlistIds] }
})
watch([dailyLimit, timePoolId, playlistIds], () => { saved.value = false }, { deep: true })
async function save() {
  saving.value = true
  error.value = ''
  saved.value = false
  try {
    // A removed approval must not survive in an unsaved selection.
    const selected = playlistIds.value.filter(id => props.playlists.some(playlist => playlist.id === id))
    await apiFetch(`/api/admin/children/${props.childId}/cartoon-pool`, { method: 'PUT', body: { dailyLimit: dailyLimit.value, timePoolId: timePoolId.value, playlistIds: selected } })
    saved.value = true
    await refreshCredits().catch(() => undefined)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Unable to save Cartoon Pool' }
  finally { saving.value = false }
}
</script>

<template>
  <UCard class="mb-5 rounded-2xl">
    <template #header><h2 class="text-lg font-semibold">Episode unlocking</h2><p class="text-sm text-[var(--zt-muted)]">Choose which Playlists use daily unlock credits for this Child.</p></template>
    <div v-if="loadError" role="alert" class="flex items-center gap-3"><span>{{ loadError.message }}</span><UButton variant="soft" @click="refresh().catch(() => undefined)">Retry</UButton></div>
    <section aria-label="Today’s unlock credits" class="mb-4 rounded-xl border border-[var(--zt-border)] p-3 space-y-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div><h3 class="font-semibold">Today’s unlock credits</h3><p v-if="credits?.viewingDay" class="text-sm">{{ credits.remaining }} of {{ credits.totalCredits ?? credits.dailyLimit }} left · {{ credits.bonusCredits ?? 0 }} extra granted</p></div>
        <UButton :loading="granting" :disabled="!credits?.viewingDay || saving" class="min-h-11" @click="grantCredit">{{ grantError && pendingGrant ? 'Retry granting 1 credit' : 'Add 1 credit today' }}</UButton>
      </div>
      <p class="text-sm text-[var(--zt-muted)]">Fix an accidental unlock by granting another credit. Unused extra credits expire at this Child’s local midnight; daily settings and viewing time stay the same.</p>
      <p v-if="grantNotice" role="status" class="text-sm">{{ grantNotice }}</p>
      <p v-if="grantError" role="alert" class="text-sm text-red-600">{{ grantError }}</p>
      <div v-if="creditLoadError" role="alert" class="flex items-center gap-2 text-sm"><span>{{ creditLoadError.message }}</span><UButton variant="soft" :disabled="granting" @click="refreshCredits().catch(() => undefined)">Refresh credits</UButton></div>
    </section>
    <form v-if="data && !loadError" class="space-y-3" @submit.prevent="save">
      <label class="flex min-h-11 items-center gap-3 text-sm font-medium">Unlock credits per day
        <select v-model.number="dailyLimit" :disabled="saving" class="zt-surface min-h-11 rounded-lg border px-3" aria-label="Unlock credits per day"><option :value="1">1 credit</option><option :value="2">2 credits</option></select>
      </label>
      <label class="flex min-h-11 items-center gap-3 text-sm font-medium">Time pool for the cartoon library
        <select v-model="timePoolId" :disabled="saving || !pools.length" required aria-label="Time pool for the cartoon library" class="zt-surface min-h-11 rounded-lg border px-3"><option v-for="pool in pools" :key="pool.id" :value="pool.id">{{ pool.name }}</option></select>
      </label>
      <fieldset :disabled="saving"><legend class="text-sm font-semibold">Playlists in the pool</legend>
        <p v-if="!visiblePlaylists.length" class="mt-2 text-sm text-[var(--zt-muted)]">First import a Jellyfin series or approve a YouTube Playlist for this Child.</p>
        <div class="grid gap-x-4 sm:grid-cols-2">
          <label v-for="playlist in visiblePlaylists" :key="playlist.id" class="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input v-model="playlistIds" type="checkbox" :value="playlist.id" class="h-5 w-5 shrink-0 accent-[var(--zt-blue)]" />{{ playlist.playlistTitle }}</label>
        </div>
      </fieldset>
      <p class="text-sm text-[var(--zt-muted)]">One credit permanently unlocks one episode for this Child. Unused credits expire at local midnight. Unlocked episodes can be watched again without another credit; viewing still uses the selected time pool and requires Approved Content.</p>
      <div class="flex items-center gap-3"><UButton type="submit" :loading="saving" :disabled="granting" class="min-h-11">Save unlock settings</UButton><span v-if="saved" role="status" class="text-sm">Unlock settings saved.</span></div>
      <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>
    </form>
    <p v-else-if="!loadError" role="status">Loading unlock settings…</p>
  </UCard>
</template>

<style scoped>
input[type="checkbox"] { min-width: 1.25rem; min-height: 1.25rem; }
</style>
