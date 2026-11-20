<script setup lang="ts">
import { useActionToast } from '../../../../composables/use-action-toast'
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { apiFetch, useApi } from '../../../../../src/api'
import DailyUsageChart from '../../../../components/DailyUsageChart.vue'
import ViewingEvents from '../../../../components/ViewingEvents.vue'
import TimePoolManager from '../../../../components/TimePoolManager.vue'
import type { AdminChild, TimePoolsResponse, TimePoolBinding } from '../../../../../src/domain'
import ActionConfirm, { type Confirmation } from '../../../../components/ActionConfirm.vue'
import CartoonPoolSettings from '../../../../components/CartoonPoolSettings.vue'
import { useAdminViewing } from '../../../../composables/use-admin-viewing'

const route = useRoute()
const router = useRouter()
const notify = useActionToast()
const childId = parseInt(route.params.id as string)
type ContentKind = 'channel' | 'playlist' | 'video'
const confirmation = ref<Confirmation | null>(null)
const contentError = ref('')
const copyError = ref('')
const copyNotice = ref('')

const { data, refresh } = useApi<any>(`/api/admin/children/${childId}/content`)
const { data: childrenData } = useApi<{ children: AdminChild[] }>('/api/admin/children')
const childOptions = computed(() => (childrenData.value?.children ?? []).map(child => ({
  label: child.id === childId && data.value?.child
    ? data.value.child.displayName || data.value.child.email
    : child.displayName || child.email,
  value: child.id,
})))
function switchChild(id: number) {
  if (id !== childId) void router.push(`/admin/child/${id}/manage`)
}
const {
  timeData, watchTime, usageDays, usage, usageError, usageLoading, refreshUsage, detectedTimeZone, timeForm, timeSaving, timeError, timeSaved,
  clockOptions, endClockOptions, breakAfterOptions, breakDurationOptions, timeZoneOptions,
  saveTimeSettings, interventionSaving, setViewingPause,
} = useAdminViewing(childId, (description, run) => {
  confirmation.value = { title: 'Save reduced allowances?', description, label: 'Save allowances', run }
})
const poolData = ref<TimePoolsResponse | null>(null)
const selectedActivityDay = ref<string | null>(null)
watch(usage, summary => {
  if (summary && !summary.days.some(day => day.viewingDay === selectedActivityDay.value)) selectedActivityDay.value = null
})
const contentRuleOptions = computed(() => (poolData.value?.pools ?? []).map(pool => ({ label: pool.name, value: pool.id })))
function boundPool(kind: TimePoolBinding['kind'], contentId: string, legacyKey = 'restricted') {
  return poolData.value?.bindings.find(b => b.kind === kind && b.contentId === contentId)?.poolId
    ?? poolData.value?.pools.find(pool => pool.legacyKey === legacyKey)?.id
}
const profileForm = reactive({ displayName: '', avatarUrl: '' })
const profileSaving = ref(false)
const profileError = ref('')
watch(() => data.value?.child, child => {
  if (child) Object.assign(profileForm, { displayName: child.displayName || '', avatarUrl: child.avatarUrl || '' })
}, { immediate: true })

async function saveProfile() {
  profileSaving.value = true
  profileError.value = ''
  try {
    await apiFetch(`/api/admin/children/${childId}/profile`, { method: 'PUT', body: profileForm })
    await refresh()
    notify('Child profile saved.')
  } catch (cause) { profileError.value = cause instanceof Error ? cause.message : 'Unable to save Child profile' }
  finally { profileSaving.value = false }
}

const copySourceChildId = ref<number | undefined>()
const copying = ref(false)
const copyOptions = computed(() => childOptions.value.filter(child => child.value !== childId))
function requestCopyContent() {
  const sourceChildId = copySourceChildId.value
  const source = copyOptions.value.find((option: { value: number }) => option.value === sourceChildId)
  if (!sourceChildId || !source) return
  confirmation.value = {
    title: 'Copy Approved Content?',
    description: `Copy approvals, Cartoon Pool membership, default pool choices, and tags from ${source.label}. Existing matching approvals will be updated, and this Child’s allowances and unlock requirements apply.`,
    label: 'Copy content', run: () => copyContent(sourceChildId),
  }
}
async function copyContent(sourceChildId: number) {
  copying.value = true
  copyError.value = ''
  copyNotice.value = ''
  try {
    await apiFetch(`/api/admin/children/${childId}/content/copy`, { method: 'POST', body: { sourceChildId } })
    await refresh()
    copyNotice.value = 'Approved Content copied.'
    notify(copyNotice.value, { announcedInline: true })
  } catch (cause) { copyError.value = cause instanceof Error ? cause.message : 'Unable to copy Approved Content' }
  finally { copying.value = false }
}

const section = ref('time')
const sections = [{ id: 'time', label: 'Time & limits' }, { id: 'content', label: 'Content' }, { id: 'activity', label: 'Activity' }, { id: 'profile', label: 'Profile' }]
const addUrl = ref('')
const addLoading = ref(false)
const addError = ref('')
const overrideSource = ref<{ type: 'channel' | 'playlist'; id: number; title: string } | null>(null)
const videoRuleOptions = computed(() => [
  { label: `Use ${overrideSource.value?.type ?? 'source'} setting`, value: 'inherit' },
  ...contentRuleOptions.value,
])
const overrideVideos = ref<any[]>([])
const overrideLoading = ref(false)
const recommendedVideoId = ref('')
const contentSearch = ref('')
const selectedTag = ref('')
const syncingId = ref('')
const visiblePlaylists = computed(() => (data.value?.playlists ?? []).filter((item: any) => !item.playlistId?.startsWith('pl:jf:')))
const jellyfinPlaylists = computed(() => (data.value?.playlists ?? []).filter((item: any) => item.playlistId?.startsWith('pl:jf:')))
const visibleVideos = computed(() => (data.value?.videos ?? []).filter((item: any) => !item.videoId?.startsWith('jf:')))
const allTags = computed(() => [...new Set([
  ...(data.value?.channels ?? []), ...visiblePlaylists.value, ...visibleVideos.value,
].flatMap((item: any) => item.tags ?? []))].sort())
function matchesContent(item: any, title: string) {
  const query = contentSearch.value.trim().toLowerCase()
  return (!query || `${title} ${(item.tags ?? []).join(' ')}`.toLowerCase().includes(query))
    && (!selectedTag.value || item.tags?.includes(selectedTag.value))
}
const filteredChannels = computed(() => (data.value?.channels ?? []).filter((item: any) => matchesContent(item, item.channelTitle)))
const filteredPlaylists = computed(() => visiblePlaylists.value.filter((item: any) => matchesContent(item, item.playlistTitle)))
const filteredVideos = computed(() => visibleVideos.value.filter((item: any) => matchesContent(item, `${item.videoTitle} ${item.channelTitle ?? ''}`)))

async function addContent() {
  addError.value = ''
  addLoading.value = true

  try {
    await apiFetch('/api/admin/content/add', {
      method: 'POST',
      body: { childId, url: addUrl.value },
    })
    addUrl.value = ''
    await refresh()
  } catch (e: any) {
    addError.value = e.response?.message || e.message || 'Failed to add content'
  } finally {
    addLoading.value = false
  }
}

function requestRemoveContent(id: number, type: ContentKind, title: string) {
  confirmation.value = {
    title: 'Remove Approved Content?',
    description: `Remove approval for “${title}” for this Child.`,
    label: 'Remove content', destructive: true, run: () => deleteContent(id, type),
  }
}
async function deleteContent(id: number, type: ContentKind) {
  contentError.value = ''
  try {
    await apiFetch(`/api/admin/content/${id}?type=${type}`, { method: 'DELETE' })
    await refresh()
  } catch (cause) { contentError.value = cause instanceof Error ? cause.message : 'Unable to remove Approved Content' }
}

async function updatePoolBinding(contentId: string, kind: TimePoolBinding['kind'], poolId: string | null) {
  contentError.value = ''
  try {
    await apiFetch(`/api/admin/children/${childId}/time-pool-bindings`, { method: 'PUT', body: { kind, contentId, poolId } })
    poolData.value = await apiFetch<TimePoolsResponse>(`/api/admin/children/${childId}/time-pools`)
    await refresh()
  } catch (cause) { contentError.value = cause instanceof Error ? cause.message : 'Failed to update Time Pool' }
}

const tagsOpen = ref(false)
const tagTarget = ref<{ id: number; type: ContentKind; title: string } | null>(null)
const selectedTags = ref<string[]>([])
const newTag = ref('')
const tagError = ref('')
let tagsSaved = false
const tagsSaving = ref(false)
let tagTrigger: HTMLElement | null = null
const tagOptions = computed(() => {
  const library = [...(data.value?.channels ?? []), ...(data.value?.playlists ?? []), ...(data.value?.videos ?? [])]
  const existing = library.flatMap((item: { tags?: string[] }) => item.tags ?? [])
  return [...new Set([...selectedTags.value, ...existing])].sort()
})
function openTags(item: { id: number; tags?: string[] }, type: ContentKind, title: string, event: MouseEvent) {
  tagTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  tagTarget.value = { id: item.id, type, title }
  selectedTags.value = [...new Set(item.tags ?? [])]
  newTag.value = ''
  tagError.value = ''
  tagsSaved = false
  tagsOpen.value = true
}
function restoreTagFocus(event: Event) {
  if (tagTrigger?.isConnected) {
    event.preventDefault()
    tagTrigger.focus()
  }
}
function toggleTag(tag: string) {
  tagError.value = ''
  if (selectedTags.value.includes(tag)) selectedTags.value = selectedTags.value.filter(value => value !== tag)
  else if (selectedTags.value.length < 8) selectedTags.value.push(tag)
  else tagError.value = 'Choose up to 8 tags.'
}
function addTag() {
  const tag = newTag.value.trim()
  tagError.value = ''
  if (!tag) return true
  if (tag.length > 24) tagError.value = 'Use 24 characters or fewer.'
  else if (!selectedTags.value.includes(tag)) toggleTag(tag)
  if (tagError.value) return false
  newTag.value = ''
  return true
}
async function saveTags() {
  const target = tagTarget.value
  if (!target || tagsSaving.value || !addTag()) return
  tagsSaving.value = true
  try {
    await apiFetch(`/api/admin/children/${childId}/content/${target.type}/${target.id}/tags`, { method: 'PUT', body: { tags: selectedTags.value } })
    await refresh()
    tagsSaved = true
    tagsOpen.value = false
  } catch (cause) { tagError.value = cause instanceof Error ? cause.message : 'Unable to save tags' }
  finally { tagsSaving.value = false }
}

function announceSavedTags() {
  if (tagsSaved) notify('Tags saved.')
  tagsSaved = false
}

async function syncContent(item: any, type: 'channel' | 'playlist' | 'video') {
  contentError.value = ''
  syncingId.value = `${type}-${item.id}`
  try {
    await apiFetch(`/api/admin/children/${childId}/content/${type}/${item.id}/sync`, { method: 'POST' })
    if (overrideSource.value?.type === type && overrideSource.value.id === item.id) await showVideoOverrides(type, item.id, type === 'channel' ? item.channelTitle : item.playlistTitle)
  } catch (cause) {
    contentError.value = cause instanceof Error ? cause.message : 'Sync failed; automatic retry scheduled'
  } finally {
    syncingId.value = ''
    await refresh().catch(() => { contentError.value ||= 'Unable to reload Approved Content' })
  }
}

function syncLabel(item: any) {
  if (item.playlistId?.startsWith('pl:jf:')) return item.lastFetchedAt ? `Jellyfin · Updated ${new Date(item.lastFetchedAt).toLocaleDateString()}` : 'Jellyfin library'
  if (item.syncError) return item.syncError
  if (item.syncPending) return 'Sync in progress · continues automatically'
  return item.lastFetchedAt ? `Synced ${new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.round((new Date(item.lastFetchedAt).getTime() - Date.now()) / 3_600_000), 'hour')}` : 'Waiting for automatic sync (every 30 min)'
}

async function showVideoOverrides(type: 'channel' | 'playlist', id: number, title: string) {
  overrideSource.value = { type, id, title }
  overrideLoading.value = true
  try {
    const result = await apiFetch<any>(`/api/admin/children/${childId}/content/${type}/${id}/videos`)
    overrideVideos.value = result.videos
  } finally {
    overrideLoading.value = false
  }
}

function overrideFor(videoId: string) {
  return poolData.value?.bindings.find(b => b.kind === 'video' && b.contentId === videoId)?.poolId || 'inherit'
}

async function recommendVideo(videoId: string) {
  await apiFetch(`/api/admin/children/${childId}/recommendations`, { method: 'POST', body: { videoId } })
  recommendedVideoId.value = videoId
}

async function updateVideoOverride(videoId: string, poolId: string) {
  if (poolId === 'inherit') await apiFetch(`/api/admin/children/${childId}/video-rules/${encodeURIComponent(videoId)}`, { method: 'DELETE' })
  await updatePoolBinding(videoId, 'video', poolId === 'inherit' ? null : poolId)
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatPublishedDate(value: string | null): string {
  return value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(value)) : ''
}
</script>

<template>
  <div class="zt-page">
    <ActionConfirm v-model="confirmation" />
    <UModal v-model:open="tagsOpen" title="Edit tags" :description="tagTarget?.title" :close="false" :dismissible="!tagsSaving" @after:leave="announceSavedTags"
      :content="{ onCloseAutoFocus: restoreTagFocus }" :ui="{ content: 'max-w-lg', body: 'space-y-3 p-3 sm:p-4', footer: 'justify-end gap-2 p-3 sm:p-4' }">
      <template #body>
        <div v-if="tagOptions.length" class="flex max-h-44 flex-wrap items-start gap-1.5 overflow-y-auto p-1" role="group" aria-label="Library tags">
          <UButton v-for="tag in tagOptions" :key="tag" type="button" class="min-h-11 min-w-11 rounded-full" size="sm"
            :color="selectedTags.includes(tag) ? 'primary' : 'neutral'" :variant="selectedTags.includes(tag) ? 'solid' : 'outline'"
            :aria-pressed="selectedTags.includes(tag)" :disabled="tagsSaving" @click="toggleTag(tag)">{{ tag }}</UButton>
        </div>
        <form class="space-y-1" @submit.prevent="addTag">
          <label for="new-approved-tag" class="text-sm font-medium">New tag</label>
          <div class="flex gap-2">
            <UInput id="new-approved-tag" v-model="newTag" autocomplete="off" class="min-w-0 flex-1" :ui="{ base: 'min-h-11' }"
              :disabled="tagsSaving" aria-describedby="tag-limit" @input="tagError = ''" />
            <UButton type="submit" variant="soft" class="min-h-11 min-w-11" :disabled="tagsSaving || !newTag.trim()">Add tag</UButton>
          </div>
          <p id="tag-limit" class="text-xs text-[var(--zt-muted)]">{{ selectedTags.length }} of 8 selected · 24 characters per tag</p>
        </form>
        <p v-if="tagError" role="alert" class="rounded-lg border border-error/40 bg-[var(--zt-error-soft)] p-2 text-sm text-[var(--zt-error)]">{{ tagError }}</p>
      </template>
      <template #footer>
        <UButton color="neutral" variant="soft" class="min-h-11 min-w-11" :disabled="tagsSaving" @click="tagsOpen = false">Cancel</UButton>
        <UButton class="min-h-11 min-w-11" :loading="tagsSaving" @click="saveTags">Save tags</UButton>
      </template>
    </UModal>
    <header class="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <h1 class="min-w-0 truncate text-xl font-semibold">
        {{ childOptions.length > 1 ? 'Child settings' : data?.child?.displayName || data?.child?.email || 'Child settings' }}
      </h1>
      <div class="flex min-w-0 max-w-full items-center gap-2">
        <USelect v-if="childOptions.length > 1" :model-value="childId" :items="childOptions" aria-label="Switch Child"
          class="min-h-11 min-w-0 max-w-52" @update:model-value="switchChild" />
        <UButton :to="`/admin/child/${childId}/preview`" variant="soft" class="min-h-11 shrink-0">Preview viewer</UButton>
      </div>
    </header>

    <div class="zt-admin-tabs" role="tablist" aria-label="Child settings">
      <button v-for="item in sections" :id="`tab-${item.id}`" :key="item.id" role="tab" :aria-selected="section === item.id" :aria-controls="`panel-${item.id}`" @click="section = item.id">{{ item.label }}</button>
    </div>
    <section v-show="section === 'profile'" id="panel-profile" role="tabpanel" aria-labelledby="tab-profile">

    <div class="mt-3 grid gap-4 lg:grid-cols-2">
      <UCard class="rounded-2xl ring-1 ring-[var(--zt-border)]">
        <template #header><h2 class="font-semibold">Child profile</h2></template>
        <form class="grid grid-cols-[auto_1fr] items-end gap-3" @submit.prevent="saveProfile">
          <UAvatar :src="profileForm.avatarUrl" :alt="profileForm.displayName || data?.child?.email" size="xl" />
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Display name"><UInput :ui="{ base: 'min-h-11' }" v-model="profileForm.displayName" required class="w-full" /></UFormField>
            <UFormField label="Avatar URL"><UInput :ui="{ base: 'min-h-11' }" v-model="profileForm.avatarUrl" type="url" class="w-full" /></UFormField>
          </div>
          <span />
          <UButton type="submit" size="sm" :loading="profileSaving" class="min-h-11 justify-self-end">Save profile</UButton>
        </form>
        <p v-if="profileError" role="alert" class="mt-3 text-sm text-[var(--zt-error)]">{{ profileError }}</p>
      </UCard>
      <UCard class="rounded-2xl ring-1 ring-[var(--zt-border)]">
        <template #header>
          <div><h2 class="font-semibold">Copy Approved Content</h2><p class="text-xs text-[var(--zt-muted)]">Copies approvals, Cartoon Pool membership, default pool choices, and tags. The target Child’s Time Pools and unlock requirements apply; custom Pool Bindings and budgets are not copied.</p></div>
        </template>
        <div class="flex items-end gap-3">
          <UFormField label="Copy from Child" class="flex-1"><USelect v-model="copySourceChildId" :items="copyOptions" class="min-h-11 w-full" placeholder="Select a Child" /></UFormField>
          <UButton class="min-h-11" :disabled="!copySourceChildId" :loading="copying" @click="requestCopyContent">Copy</UButton>
        </div>
        <p v-if="copyError" role="alert" class="mt-3 rounded-lg border border-error/40 bg-[var(--zt-error-soft)] p-2 text-sm text-[var(--zt-error)]">{{ copyError }}</p>
        <p v-if="copyNotice" role="status" class="mt-3 text-sm">{{ copyNotice }}</p>
      </UCard>
    </div>

    </section>
    <section v-show="section === 'time'" id="panel-time" role="tabpanel" aria-labelledby="tab-time">

    <CartoonPoolSettings :child-id="childId" :pools="poolData?.pools ?? []" :playlists="data?.playlists ?? []">
      <template #viewing>
        <section class="zt-panel min-w-0 space-y-2 p-3" aria-label="Viewing today">
          <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div>
              <h2 class="font-semibold">Viewing today</h2>
              <p v-if="watchTime" class="text-sm tabular-nums text-[var(--zt-muted)]">{{ watchTime.viewingDay }}</p>
            </div>
            <span v-if="watchTime" class="zt-meta-pill" :data-tone="watchTime.policy?.blocked ? 'warning' : 'success'" role="status">
              <UIcon :name="watchTime.policy?.blocked ? 'i-heroicons-pause-circle' : 'i-heroicons-play-circle'" class="size-4" aria-hidden="true" />
              {{ watchTime.policy?.reason === 'viewing-pause' ? 'Paused' : watchTime.policy?.blocked ? 'Viewing unavailable' : 'Viewing allowed' }}
            </span>
          </div>
          <UButton v-if="watchTime" class="min-h-11" variant="soft" color="neutral"
            :class="{ 'zt-warning-action': watchTime.policy?.reason !== 'viewing-pause' }"
            :disabled="interventionSaving" @click="setViewingPause(watchTime.policy?.reason !== 'viewing-pause')">
            {{ watchTime.policy?.reason === 'viewing-pause' ? 'Resume viewing' : 'Pause viewing today' }}
          </UButton>
        </section>
      </template>
    </CartoonPoolSettings>
    <p v-if="timeError" role="alert" class="mb-3 rounded-lg border border-error/40 bg-[var(--zt-error-soft)] p-2 text-sm text-[var(--zt-error)]">{{ timeError }}</p>
    <TimePoolManager :child-id="childId" @loaded="poolData = $event" />

    <details class="mb-4 rounded-xl border border-[var(--zt-border)] px-3"><summary class="min-h-12 cursor-pointer content-center font-medium">Viewing hours &amp; breaks</summary>
    <div class="grid gap-4">
    <UCard class="rounded-2xl ring-1 ring-[var(--zt-border)]">
      <template #header>
        <div>
          <h2 class="text-lg font-semibold">Viewing routine</h2>
          <p class="text-sm text-[var(--zt-muted)]">Viewing hours and breaks apply across every time pool.</p>
        </div>
      </template>
      <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="saveTimeSettings()">
        <UFormField label="Time zone" class="md:col-span-2">
          <USelect v-model="timeForm.timeZone" :items="timeZoneOptions" class="w-full" />
          <template #hint>Initially suggested from this browser: {{ detectedTimeZone }}</template>
        </UFormField>
        <UFormField label="Viewing Window starts"><USelect v-model="timeForm.allowedStartMinute" :items="clockOptions" class="w-full" /></UFormField>
        <UFormField label="Viewing Window ends"><USelect v-model="timeForm.allowedEndMinute" :items="endClockOptions" class="w-full" /></UFormField>
        <UFormField label="Required Break"><USelect v-model="timeForm.breakAfterMinutes" :items="breakAfterOptions" class="w-full" /></UFormField>
        <UFormField label="Break duration"><USelect v-model="timeForm.breakDurationMinutes" :items="breakDurationOptions" :disabled="timeForm.breakAfterMinutes === 0" class="w-full" /></UFormField>
        <div class="flex items-end justify-end">
          <UButton type="submit" class="min-h-11" :loading="timeSaving">Save viewing routine</UButton>
        </div>
        <UAlert v-if="timeSaved" color="success" title="Viewing routine saved" class="md:col-span-2" />
        <p v-if="timeData?.viewingDay" class="text-sm text-[var(--zt-muted)] md:col-span-2">
          Current Viewing Day: {{ timeData.viewingDay.localDate }} ·
          {{ timeData.viewingDay.isWeekend ? 'Weekend' : 'Weekday' }} pool allowances apply.
        </p>
      </form>
    </UCard>


    </div>
    </details>

    </section>
    <section v-show="section === 'content'" id="panel-content" role="tabpanel" aria-labelledby="tab-content">
    <div class="flex flex-wrap items-center justify-between gap-3"><div><h2 class="text-xl font-semibold">Approved content</h2><p class="text-sm text-[var(--zt-muted)]">Add YouTube links here. Manage imported series in the Jellyfin library.</p></div><UButton to="/admin/jellyfin" variant="soft">Jellyfin library</UButton></div>
    <p v-if="contentError" role="alert" class="my-3 rounded-lg border border-error/40 bg-[var(--zt-error-soft)] p-2 text-sm text-[var(--zt-error)]">{{ contentError }}</p>
    <section class="my-5 rounded-xl border border-[var(--zt-border)] p-3" aria-label="Child Jellyfin access">
      <h3 class="font-semibold">Jellyfin</h3><p v-if="!jellyfinPlaylists.length" class="py-2 text-sm text-[var(--zt-muted)]">No shared series. Choose this child in the Jellyfin library to grant access.</p>
      <div v-for="item in jellyfinPlaylists" :key="item.id" class="flex items-center justify-between gap-3 border-t border-[var(--zt-border)] py-2"><div class="min-w-0"><p class="font-medium">{{ item.playlistTitle }}</p><p class="text-sm text-[var(--zt-muted)]">{{ item.cartoonPool ? 'Uses the cartoon library time pool and unlock credits' : 'Approved for this child' }}</p></div><UButton color="neutral" variant="ghost" class="min-h-11" @click="requestRemoveContent(item.id, 'playlist', item.playlistTitle)">Remove access</UButton></div>
    </section>
    <h3 class="text-lg font-semibold">YouTube</h3>
    <!-- Add Content Form -->
    <UCard class="my-5 rounded-2xl ring-1 ring-[var(--zt-border)]">
      <form @submit.prevent="addContent" class="flex flex-col gap-3 sm:flex-row">
        <UInput
          v-model="addUrl"
          :ui="{ base: 'min-h-11' }"
          placeholder="Paste YouTube URL (video, playlist, or channel)"
          aria-label="YouTube video, playlist, or channel URL"
          class="min-w-0 flex-1"
          required
        />
        <UButton type="submit" class="min-h-11" :loading="addLoading">
          Add
        </UButton>
      </form>
      <UAlert v-if="addError" color="error" :title="addError" class="mt-4" />
    </UCard>

    <div class="mb-4 text-sm text-[var(--zt-muted)]">
      <p class="font-semibold text-[var(--zt-text)]">Viewing time for approved content</p>
      <p class="mt-1">Choose a time pool for each channel, playlist, or video. Video bindings take priority over playlists, then channels. Conflicting bindings at the same level require an explicit video binding.</p>
    </div>

    <div class="mb-3 flex flex-wrap items-center gap-2">
      <UInput v-model="contentSearch" :ui="{ base: 'min-h-11' }" icon="i-heroicons-magnifying-glass" aria-label="Search Approved Content or tags"
        placeholder="Search Approved Content or tags" class="min-w-0 flex-1 basis-60" />
      <UButton class="min-h-11 min-w-11" :variant="selectedTag ? 'soft' : 'solid'" color="neutral" @click="selectedTag = ''">All</UButton>
      <UButton v-for="tag in allTags" :key="tag" class="min-h-11 min-w-11" :variant="selectedTag === tag ? 'solid' : 'soft'" color="neutral" @click="selectedTag = tag">{{ tag }}</UButton>
    </div>

    <!-- Content Tabs -->
    <UTabs class="zt-panel p-3" :ui="{ trigger: 'min-h-11' }" :items="[
      { label: `Channels (${data?.channels?.length || 0})`, slot: 'channels' },
      { label: `Playlists (${visiblePlaylists.length})`, slot: 'playlists' },
      { label: `Videos (${visibleVideos.length})`, slot: 'videos' },
    ]">
      <template #channels>
        <div v-if="!filteredChannels.length" class="text-center py-8 text-[var(--zt-muted)]">
          No matching channels
        </div>
        <div v-else class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <UCard v-for="channel in filteredChannels" :key="channel.id" class="min-w-0 rounded-xl" :ui="{ body: 'p-3 sm:p-3', footer: 'p-2 sm:p-3' }" :class="{ 'opacity-50': !channel.isAvailable }">
            <div class="flex items-center gap-3">
              <UAvatar :src="channel.channelThumbnail" :alt="channel.channelTitle" size="lg" />
              <div class="flex-1 min-w-0">
                <p class="font-medium truncate">{{ channel.channelTitle }}</p>
                <p v-if="!channel.isAvailable" class="text-xs text-[var(--zt-error)]">Unavailable</p>
                <p class="text-xs text-[var(--zt-muted)]">{{ syncLabel(channel) }}</p>
              </div>
            </div>
            <div v-if="channel.tags?.length" class="mt-2 flex flex-wrap gap-1"><UBadge v-for="tag in channel.tags" :key="tag" color="neutral" variant="soft">{{ tag }}</UBadge></div>
            <template #footer>
              <div class="grid gap-1.5">
                <USelect :model-value="boundPool('channel', channel.channelId, channel.contentRule)" :aria-label="`Time pool for ${channel.channelTitle}`" :items="contentRuleOptions" class="min-h-11 min-w-0 w-full" size="sm" @update:model-value="updatePoolBinding(channel.channelId, 'channel', String($event))" />
                <div class="flex flex-wrap gap-1">
                  <UButton variant="ghost" size="sm" class="min-h-11 min-w-11" @click="showVideoOverrides('channel', channel.id, channel.channelTitle)">Video overrides</UButton>
                  <UButton variant="ghost" size="sm" class="min-h-11 min-w-11" :loading="syncingId === `channel-${channel.id}`" @click="syncContent(channel, 'channel')">Sync</UButton>
                  <UButton variant="ghost" size="sm" class="min-h-11 min-w-11" @click="openTags(channel, 'channel', channel.channelTitle, $event)">Tags</UButton>
                  <UButton color="neutral" variant="ghost" size="sm" class="min-h-11 min-w-11" icon="i-heroicons-trash" @click="requestRemoveContent(channel.id, 'channel', channel.channelTitle)">Remove</UButton>
                </div>
              </div>
            </template>
          </UCard>
        </div>
      </template>

      <template #playlists>
        <div v-if="!filteredPlaylists.length" class="text-center py-8 text-[var(--zt-muted)]">
          No matching playlists
        </div>
        <div v-else class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <UCard v-for="playlist in filteredPlaylists" :key="playlist.id" class="min-w-0 rounded-xl" :ui="{ body: 'p-3 sm:p-3', footer: 'p-2 sm:p-3' }" :class="{ 'opacity-50': !playlist.isAvailable }">
            <img :src="playlist.playlistThumbnail" :alt="playlist.playlistTitle" class="mb-2 h-20 w-36 rounded-lg object-cover" />
            <p class="font-medium truncate">{{ playlist.playlistTitle }}</p>
            <p v-if="!playlist.isAvailable" class="text-xs text-[var(--zt-error)]">Unavailable</p>
            <p class="text-xs text-[var(--zt-muted)]">{{ syncLabel(playlist) }}</p>
            <div v-if="playlist.tags?.length" class="mt-2 flex flex-wrap gap-1"><UBadge v-for="tag in playlist.tags" :key="tag" color="neutral" variant="soft">{{ tag }}</UBadge></div>
            <template #footer>
              <div class="grid gap-1.5">
                <USelect :model-value="boundPool('playlist', playlist.playlistId, playlist.contentRule)" :aria-label="`Time pool for ${playlist.playlistTitle}`" :items="contentRuleOptions" class="min-h-11 min-w-0 w-full" size="sm" @update:model-value="updatePoolBinding(playlist.playlistId, 'playlist', String($event))" />
                <div class="flex flex-wrap gap-1">
                  <UButton variant="ghost" size="sm" class="min-h-11 min-w-11" @click="showVideoOverrides('playlist', playlist.id, playlist.playlistTitle)">Video overrides</UButton>
                  <UButton variant="ghost" size="sm" class="min-h-11 min-w-11" :loading="syncingId === `playlist-${playlist.id}`" @click="syncContent(playlist, 'playlist')">Sync</UButton>
                  <UButton variant="ghost" size="sm" class="min-h-11 min-w-11" @click="openTags(playlist, 'playlist', playlist.playlistTitle, $event)">Tags</UButton>
                  <UButton color="neutral" variant="ghost" size="sm" class="min-h-11 min-w-11" icon="i-heroicons-trash" @click="requestRemoveContent(playlist.id, 'playlist', playlist.playlistTitle)">Remove</UButton>
                </div>
              </div>
            </template>
          </UCard>
        </div>
      </template>

      <template #videos>
        <div v-if="!filteredVideos.length" class="text-center py-8 text-[var(--zt-muted)]">
          No matching videos
        </div>
        <div v-else class="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <UCard v-for="video in filteredVideos" :key="video.videoId" class="min-w-0 rounded-xl" :ui="{ body: 'p-3 sm:p-3', footer: 'p-2 sm:p-3' }" :class="{ 'opacity-50': !video.isAvailable }">
            <div class="relative">
              <img :src="video.videoThumbnail" :alt="video.videoTitle" class="h-20 w-36 rounded-lg object-cover" />
              <span v-if="video.duration" class="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 rounded">
                {{ formatDuration(video.duration) }}
              </span>
            </div>
            <p class="font-medium truncate mt-2">{{ video.videoTitle }}</p>
            <p class="text-sm text-[var(--zt-muted)] truncate">{{ video.channelTitle }}</p>
            <p v-if="video.publishedAt" class="text-sm text-[var(--zt-muted)]">{{ formatPublishedDate(video.publishedAt) }}</p>
            <p v-if="!video.isAvailable" class="text-xs text-[var(--zt-error)]">Unavailable</p>
            <p class="text-xs text-[var(--zt-muted)]">{{ syncLabel(video) }}</p>
            <div v-if="video.tags?.length" class="mt-2 flex flex-wrap gap-1"><UBadge v-for="tag in video.tags" :key="tag" color="neutral" variant="soft">{{ tag }}</UBadge></div>
            <template #footer>
              <div class="grid gap-1.5">
                <USelect :model-value="boundPool('video', video.videoId, video.contentRule)" :aria-label="`Time pool for ${video.videoTitle}`" :items="contentRuleOptions" class="min-h-11 min-w-0 w-full" size="sm" @update:model-value="updatePoolBinding(video.videoId, 'video', String($event))" />
                <div class="flex flex-wrap gap-1">
                  <UButton color="primary" variant="soft" size="sm" class="min-h-11 min-w-11" icon="i-heroicons-megaphone" @click="recommendVideo(video.videoId)">{{ recommendedVideoId === video.videoId ? 'Recommended' : 'Recommend again' }}</UButton>
                  <UButton variant="ghost" size="sm" class="min-h-11 min-w-11" :loading="syncingId === `video-${video.id}`" @click="syncContent(video, 'video')">Sync</UButton>
                  <UButton variant="ghost" size="sm" class="min-h-11 min-w-11" @click="openTags(video, 'video', video.videoTitle, $event)">Tags</UButton>
                  <UButton color="neutral" variant="ghost" size="sm" class="min-h-11 min-w-11" icon="i-heroicons-trash" @click="requestRemoveContent(video.id, 'video', video.videoTitle)">Remove</UButton>
                </div>
              </div>
            </template>
          </UCard>
        </div>
      </template>
    </UTabs>

    <UCard v-if="overrideSource" class="mt-8">
      <template #header>
        <div class="flex items-center justify-between">
          <div>
            <h2 class="font-semibold">Video-specific time pools</h2>
            <p class="text-sm text-[var(--zt-muted)]">{{ overrideSource.title }} · These overrides do not create duplicate video cards.</p>
          </div>
          <UButton variant="ghost" class="min-h-11" @click="overrideSource = null">Close</UButton>
        </div>
      </template>
      <p v-if="overrideLoading">Loading videos…</p>
      <p v-else-if="!overrideVideos.length" class="text-[var(--zt-muted)]">No videos are cached yet. Use Sync on the content card and try again.</p>
      <div v-else class="divide-y">
        <div v-for="video in overrideVideos" :key="video.videoId" class="flex flex-wrap items-center gap-2 py-3">
          <img :src="video.videoThumbnail" :alt="video.videoTitle" class="h-12 w-20 rounded object-cover" />
          <p class="flex-1 truncate">{{ video.videoTitle }}</p>
          <USelect :model-value="overrideFor(video.videoId)" :items="videoRuleOptions" class="min-h-11 min-w-0 w-48 max-w-full" size="sm" @update:model-value="updateVideoOverride(video.videoId, String($event))" />
          <UButton color="primary" variant="soft" icon="i-heroicons-megaphone" class="min-h-11" @click="recommendVideo(video.videoId)">{{ recommendedVideoId === video.videoId ? 'Recommended' : 'Recommend' }}</UButton>
        </div>
      </div>
    </UCard>

    </section>
    <section v-show="section === 'activity'" id="panel-activity" role="tabpanel" aria-labelledby="tab-activity">
    <UCard class="my-5 rounded-2xl ring-1 ring-[var(--zt-border)]">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-semibold">Daily Usage Summary</h2>
          <USelect v-model="usageDays" aria-label="Usage date range" :items="[{ label: '7 days', value: 7 }, { label: '30 days', value: 30 }]" class="min-h-11 w-28" />
        </div>
      </template>
      <p v-if="usageError" role="alert" class="text-sm text-[var(--zt-error)]">{{ usageError }} <UButton variant="ghost" class="min-h-11" @click="refreshUsage">Retry</UButton></p>
      <p v-else-if="usageLoading" class="text-sm text-[var(--zt-muted)]">Loading usage…</p>
      <DailyUsageChart v-else-if="usage" v-model:selected-day="selectedActivityDay" :days="usage.days" />
    </UCard>
    <ViewingEvents :key="childId" v-model:selected-day="selectedActivityDay" :child-id="childId" :daily-totals="usage?.days" />
    </section>

  </div>
</template>
