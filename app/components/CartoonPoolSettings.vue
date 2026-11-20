<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { EpisodeClaimStatus, TimePoolStatus } from '../../src/domain'
import { useActionToast } from '../composables/use-action-toast'
import { apiFetch, ApiError, useApi } from '../../src/api'

const props = defineProps<{ childId: number; pools: TimePoolStatus[]; playlists: { id: number; playlistTitle: string }[] }>()
type Settings = { dailyLimit: number; timePoolId: string; playlistIds: number[] }
const { data, error: loadError, refresh } = useApi<Settings>(`/api/admin/children/${props.childId}/cartoon-pool`)
const creditPath = `/api/admin/children/${props.childId}/unlock-credits`
const { data: credits, error: creditLoadError, refresh: refreshCredits } = useApi<EpisodeClaimStatus>(creditPath)
const notify = useActionToast()
const rulesOpen = ref(false)
const poolOptions = computed(() => props.pools.map(pool => ({ label: pool.name, value: pool.id })))
const dailyOptions = [{ label: '1 credit', value: 1 }, { label: '2 credits', value: 2 }]
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
    notify(grantNotice.value, { announcedInline: true })
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
function togglePlaylist(id: number, checked: boolean) {
  playlistIds.value = checked ? [...new Set([...playlistIds.value, id])] : playlistIds.value.filter(item => item !== id)
}
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
  <div class="mb-4 space-y-3">
    <div class="grid gap-3 sm:grid-cols-2">
      <slot name="viewing" />
      <section aria-label="Today’s unlock credits" class="zt-panel min-w-0 space-y-2 p-3">
        <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div class="min-w-0">
            <h2 class="font-semibold">Today’s unlock credits</h2>
            <p v-if="credits?.viewingDay" class="text-sm tabular-nums text-[var(--zt-muted)]">{{ credits.remaining }} of {{ credits.totalCredits ?? credits.dailyLimit }} left · {{ credits.bonusCredits ?? 0 }} extra granted</p>
            <p v-else class="text-sm text-[var(--zt-muted)]">Checking credits…</p>
          </div>
          <UButton :loading="granting" :disabled="!credits?.viewingDay || saving" variant="soft" class="min-h-11" @click="grantCredit">{{ grantError && pendingGrant ? 'Retry granting 1 credit' : 'Add 1 credit today' }}</UButton>
        </div>
        <UButton color="neutral" variant="ghost" class="min-h-11" :trailing-icon="rulesOpen ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'"
          :aria-expanded="rulesOpen" aria-controls="unlock-rules" @click="rulesOpen = !rulesOpen">Edit unlock rules</UButton>
        <p v-if="grantNotice" role="status" class="text-sm text-[var(--zt-success)]">{{ grantNotice }}</p>
        <p v-if="grantError" role="alert" class="text-sm text-[var(--zt-error)]">{{ grantError }}</p>
        <div v-if="creditLoadError" role="alert" class="flex flex-wrap items-center gap-2 text-sm">
          <span>{{ creditLoadError.message }}</span>
          <UButton variant="soft" class="min-h-11" :disabled="granting" @click="refreshCredits().catch(() => undefined)">Refresh credits</UButton>
        </div>
      </section>
    </div>
    <section v-show="rulesOpen" id="unlock-rules" class="zt-panel space-y-3 p-3" aria-labelledby="unlock-rules-title">
      <h2 id="unlock-rules-title" class="font-semibold">Episode unlocking</h2>
      <div v-if="loadError" role="alert" class="flex flex-wrap items-center gap-2 text-sm">
        <span>{{ loadError.message }}</span><UButton variant="soft" class="min-h-11" @click="refresh().catch(() => undefined)">Retry</UButton>
      </div>
      <form v-if="data && !loadError" class="space-y-3" @submit.prevent="save">
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField label="Unlock credits per day">
            <USelect v-model="dailyLimit" :items="dailyOptions" :disabled="saving" class="min-h-11 w-full" />
          </UFormField>
          <UFormField label="Time pool for the cartoon library">
            <USelect v-model="timePoolId" :items="poolOptions" :disabled="saving || !pools.length" class="min-h-11 w-full" />
          </UFormField>
        </div>
        <fieldset :disabled="saving">
          <legend class="text-sm font-semibold">Playlists in the pool</legend>
          <p v-if="!playlists.length" class="mt-2 text-sm text-[var(--zt-muted)]">Import a Jellyfin series or approve a YouTube Playlist for this Child.</p>
          <div class="mt-1 grid gap-2 sm:grid-cols-2">
            <UCheckbox v-for="playlist in playlists" :key="playlist.id" :label="playlist.playlistTitle"
              :model-value="playlistIds.includes(playlist.id)" :disabled="saving" class="zt-check-row"
              :ui="{ root: 'items-center', wrapper: 'min-w-0 flex-1', label: 'flex min-h-11 items-center break-words' }"
              @update:model-value="togglePlaylist(playlist.id, $event === true)" />
          </div>
        </fieldset>
        <p class="text-sm text-[var(--zt-muted)]">One credit unlocks an episode for this Child. Unused credits expire at local midnight.</p>
        <div class="flex flex-wrap items-center gap-3"><UButton type="submit" :loading="saving" :disabled="granting || !pools.length || !timePoolId" class="min-h-11">Save unlock settings</UButton><span v-if="saved" role="status" class="text-sm text-[var(--zt-success)]">Unlock settings saved.</span></div>
        <p v-if="error" role="alert" class="text-sm text-[var(--zt-error)]">{{ error }}</p>
      </form>
      <p v-else-if="!loadError" role="status">Loading unlock settings…</p>
    </section>
  </div>
</template>
