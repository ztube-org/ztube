<script setup lang="ts">
import { ref } from 'vue'
import { apiFetch } from '../../src/api'
import type { TimePoolsResponse, TimePoolStatus } from '../../src/domain'
import { useActionToast } from '../composables/use-action-toast'

const props = defineProps<{ childId: number }>()
const emit = defineEmits<{ loaded: [data: TimePoolsResponse] }>()
const notify = useActionToast()
const path = `/api/admin/children/${props.childId}/time-pools`
const data = ref<TimePoolsResponse | null>(null)
const error = ref('')
const notice = ref('')
const busy = ref(false)
const editorOpen = ref(false)
const editingId = ref<string>()
const editorError = ref('')
const draft = ref({ name: '', weekdayMinutes: 30, weekendMinutes: 30, requiresClaim: false })
let editorTrigger: HTMLElement | null = null
let editorNotice = ''

async function refresh() {
  try {
    data.value = await apiFetch<TimePoolsResponse>(path)
    emit('loaded', data.value)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Unable to load Time Pools' }
}

async function refreshPools() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try { await refresh() } finally { busy.value = false }
}
void refreshPools()

function openEditor(event: MouseEvent, pool?: TimePoolStatus) {
  editorTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  editingId.value = pool?.id
  draft.value = pool ? {
    name: pool.name, weekdayMinutes: pool.weekdayMinutes, weekendMinutes: pool.weekendMinutes, requiresClaim: pool.requiresClaim,
  } : { name: '', weekdayMinutes: 30, weekendMinutes: 30, requiresClaim: false }
  editorError.value = ''
  editorNotice = ''
  editorOpen.value = true
}

function restoreEditorFocus(event: Event) {
  if (!editorTrigger?.isConnected) return
  event.preventDefault()
  editorTrigger.focus()
}

function announce(message: string) {
  notice.value = message
  notify(message, { announcedInline: true })
}

function announceEditorSave() {
  if (editorNotice) announce(editorNotice)
  editorNotice = ''
}

async function savePool() {
  if (busy.value || !draft.value.name.trim()) return
  busy.value = true
  editorError.value = ''; error.value = ''; notice.value = ''
  try {
    const id = editingId.value
    const body = { ...draft.value, name: draft.value.name.trim() }
    await apiFetch(id ? `${path}/${encodeURIComponent(id)}` : path, { method: id ? 'PUT' : 'POST', body })
    editorNotice = id ? `${body.name} saved.` : `${body.name} added.`
    await refresh()
    editorOpen.value = false
  } catch (cause) { editorError.value = cause instanceof Error ? cause.message : 'Unable to save Time Pool' }
  finally { busy.value = false }
}

async function extend(pool: TimePoolStatus, minutes: number) {
  if (busy.value) return
  busy.value = true
  error.value = ''; notice.value = ''
  try {
    await apiFetch(`${path}/${encodeURIComponent(pool.id)}/extensions`, { method: 'POST', body: { minutes } })
    announce(`${minutes} minutes added to ${pool.name} for today.`)
    await refresh()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Unable to extend Time Pool' }
  finally { busy.value = false }
}

function allowanceSeconds(pool: TimePoolStatus) {
  return Math.max(1, pool.unlocked ? 86400 : (pool.allowanceMinutes + pool.extensionMinutes) * 60)
}
</script>

<template>
  <section class="mb-5 space-y-3" aria-label="Time pools">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-xl font-semibold">Time pools</h2>
      <div class="flex flex-wrap gap-1">
        <UButton variant="ghost" color="neutral" class="min-h-11" icon="i-heroicons-arrow-path" :disabled="busy" @click="refreshPools">Refresh pools</UButton>
        <UButton variant="soft" class="min-h-11" icon="i-heroicons-plus" :disabled="busy" @click="openEditor($event)">Add time pool</UButton>
      </div>
    </div>
    <p v-if="error" role="alert" class="text-sm text-[var(--zt-error)]">{{ error }}</p>
    <p v-if="notice" role="status" class="text-sm text-[var(--zt-success)]">{{ notice }}</p>
    <div class="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
      <article v-for="pool in data?.pools" :key="pool.id" :aria-label="`${pool.name} time pool`" class="zt-panel flex min-w-0 flex-col gap-2.5 p-3">
        <div class="flex items-center justify-between gap-2">
          <h3 class="min-w-0 break-words font-semibold">{{ pool.name }}</h3>
          <UButton color="neutral" variant="ghost" class="min-h-11 min-w-11 shrink-0" :disabled="busy" :aria-label="`Edit ${pool.name}`" @click="openEditor($event, pool)">Edit</UButton>
        </div>
        <div>
          <p class="tabular-nums"><strong class="text-2xl leading-none">{{ Math.ceil(pool.remainingSeconds / 60) }}</strong> <span class="text-sm text-[var(--zt-muted)]">min left</span></p>
          <progress :value="pool.remainingSeconds" :max="allowanceSeconds(pool)" :aria-label="`${pool.name} time remaining today`"
            class="zt-pool-progress mt-2" :class="{ 'zt-pool-progress--low': pool.remainingSeconds <= 600 }" />
          <p class="mt-1 text-xs tabular-nums text-[var(--zt-muted)]">{{ Math.floor(pool.usedSeconds / 60) }} min used<span v-if="pool.extensionMinutes"> · +{{ pool.extensionMinutes }} min today</span></p>
        </div>
        <div class="mt-auto grid grid-cols-3 gap-1">
          <UButton v-for="minutes in [15, 30, 60]" :key="minutes" variant="soft" :disabled="busy"
            :aria-label="`Add ${minutes} minutes to ${pool.name} today`" class="min-h-11 min-w-11 justify-center px-1" @click="extend(pool, minutes)">+{{ minutes }} min</UButton>
        </div>
      </article>
    </div>

    <UModal v-model:open="editorOpen" :title="editingId ? 'Edit time pool' : 'Add time pool'"
      description="Set recurring allowances for this Child." :close="false" :dismissible="!busy"
      :content="{ onCloseAutoFocus: restoreEditorFocus }" @after:leave="announceEditorSave">
      <template #body>
        <form class="space-y-3" @submit.prevent="savePool">
          <UFormField label="Pool name" required>
            <UInput v-model="draft.name" autofocus required maxlength="40" :disabled="busy" :ui="{ base: 'min-h-11' }" class="w-full" />
          </UFormField>
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Weekday minutes" required>
              <UInput v-model.number="draft.weekdayMinutes" type="number" min="0" max="1440" step="1" required :disabled="busy" :ui="{ base: 'min-h-11' }" class="w-full" />
            </UFormField>
            <UFormField label="Weekend minutes" required>
              <UInput v-model.number="draft.weekendMinutes" type="number" min="0" max="1440" step="1" required :disabled="busy" :ui="{ base: 'min-h-11' }" class="w-full" />
            </UFormField>
          </div>
          <UCheckbox v-model="draft.requiresClaim" label="Unlock required before first play" :disabled="busy"
            class="zt-check-row" :ui="{ root: 'items-center', wrapper: 'min-w-0 flex-1', label: 'flex min-h-11 items-center' }" />
          <p v-if="editorError" role="alert" class="text-sm text-[var(--zt-error)]">{{ editorError }}</p>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="soft" class="min-h-11" :disabled="busy" @click="editorOpen = false">Cancel</UButton>
            <UButton type="submit" class="min-h-11" :loading="busy" :disabled="!draft.name.trim()">{{ editingId ? 'Save pool' : 'Add time pool' }}</UButton>
          </div>
        </form>
      </template>
    </UModal>
  </section>
</template>
