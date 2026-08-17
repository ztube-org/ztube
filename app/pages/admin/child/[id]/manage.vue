<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ApiError, apiFetch, useApi } from '../../../../../src/api'

const route = useRoute()
const childId = parseInt(route.params.id as string)

const { data, refresh } = useApi<any>(`/api/admin/children/${childId}/content`)
const { data: timeData, refresh: refreshTimeSettings } = useApi<any>(`/api/admin/children/${childId}/time-settings`)
const { data: watchTime, refresh: refreshWatchTime } = useApi<any>(`/api/admin/children/${childId}/watch-time`)
const { data: childrenData } = useApi<any>('/api/admin/children')
const usageDays = ref<7 | 30>(7)
const usage = ref<any>(null)

async function refreshUsage() {
  usage.value = await apiFetch(`/api/admin/children/${childId}/usage?days=${usageDays.value}`)
}
void refreshUsage()
watch(usageDays, refreshUsage)

const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const timeForm = reactive({
  timeZone: detectedTimeZone,
  weekdayAllowanceMinutes: 60,
  weekendAllowanceMinutes: 120,
  safetyCapMinutes: 180,
  allowedStartMinute: 0,
  allowedEndMinute: 1440,
  breakAfterMinutes: 0,
  breakDurationMinutes: 15,
})
const timeSaving = ref(false)
const timeError = ref('')
const timeSaved = ref(false)
const allowanceOptions = Array.from({ length: 97 }, (_, index) => ({ label: `${index * 15} minutes`, value: index * 15 }))
const clockOptions = Array.from({ length: 96 }, (_, index) => {
  const minute = index * 15
  const hour = Math.floor(minute / 60)
  const value = new Date(2000, 0, 1, hour, minute % 60).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return { label: value, value: minute }
})
const endClockOptions = [...clockOptions.slice(1), { label: '12:00 AM (next day)', value: 1440 }]
const breakAfterOptions = [{ label: 'No required breaks', value: 0 }, ...Array.from({ length: 16 }, (_, index) => ({ label: `After ${(index + 1) * 15} minutes`, value: (index + 1) * 15 }))]
const breakDurationOptions = Array.from({ length: 12 }, (_, index) => ({ label: `${(index + 1) * 5} minutes`, value: (index + 1) * 5 }))
const contentRuleOptions = [
  { label: 'Uses Daily Allowance', value: 'restricted' },
  { label: 'Safety Cap only', value: 'exempt' },
]
const timeZoneOptions = computed(() => {
  const supportedValuesOf = (Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf
  const zones = supportedValuesOf?.('timeZone') ?? ['UTC', detectedTimeZone]
  return [...new Set(zones)].map(value => ({ label: value.replaceAll('_', ' '), value }))
})

watch(() => timeData.value?.settings, (settings) => {
  if (settings) Object.assign(timeForm, settings)
}, { immediate: true })

async function saveTimeSettings() {
  timeSaving.value = true
  timeError.value = ''
  timeSaved.value = false
  try {
    try {
      await apiFetch(`/api/admin/children/${childId}/time-settings`, { method: 'PUT', body: timeForm })
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409 || error.response.requiresConfirmation !== true
        || !confirm(`${error.message}\n\nSave these recurring allowances anyway?`)) throw error
      await apiFetch(`/api/admin/children/${childId}/time-settings`, { method: 'PUT', body: { ...timeForm, confirmReduction: true } })
    }
    await refreshTimeSettings()
    await refreshWatchTime()
    timeSaved.value = true
  } catch (error) {
    timeError.value = error instanceof Error ? error.message : 'Failed to save time settings'
  } finally {
    timeSaving.value = false
  }
}

const interventionSaving = ref(false)
async function extendToday(bucket: 'restricted' | 'exempt', minutes: 15 | 30 | 60) {
  interventionSaving.value = true
  try {
    await apiFetch(`/api/admin/children/${childId}/watch-time/extensions`, { method: 'POST', body: { bucket, minutes } })
    await refreshWatchTime()
  } finally { interventionSaving.value = false }
}

async function setRestrictedUnlock(unlocked: boolean) {
  interventionSaving.value = true
  try {
    await apiFetch(`/api/admin/children/${childId}/watch-time/restricted-unlock`, { method: 'PUT', body: { unlocked } })
    await refreshWatchTime()
  } finally { interventionSaving.value = false }
}

async function setViewingPause(paused: boolean) {
  interventionSaving.value = true
  try {
    await apiFetch(`/api/admin/children/${childId}/watch-time/viewing-pause`, { method: 'PUT', body: { paused } })
    await refreshWatchTime()
  } finally { interventionSaving.value = false }
}

const profileForm = reactive({ displayName: '', avatarUrl: '' })
const profileSaving = ref(false)
watch(() => data.value?.child, child => {
  if (child) Object.assign(profileForm, { displayName: child.displayName || '', avatarUrl: child.avatarUrl || '' })
}, { immediate: true })

async function saveProfile() {
  profileSaving.value = true
  try {
    await apiFetch(`/api/admin/children/${childId}/profile`, { method: 'PUT', body: profileForm })
    await refresh()
  } finally { profileSaving.value = false }
}

const copySourceChildId = ref<number | undefined>()
const copying = ref(false)
const copyOptions = computed(() => (childrenData.value?.children ?? [])
  .filter((child: any) => child.id !== childId)
  .map((child: any) => ({ label: child.displayName || child.email, value: child.id })))
async function copyContent() {
  if (!copySourceChildId.value || !confirm('Copy Approved Content, Content Rules, and tags from this Child? Existing matching items will be updated.')) return
  copying.value = true
  try {
    await apiFetch(`/api/admin/children/${childId}/content/copy`, { method: 'POST', body: { sourceChildId: copySourceChildId.value } })
    await refresh()
  } finally { copying.value = false }
}

const activeTab = ref('channels')
const addUrl = ref('')
const addLoading = ref(false)
const addError = ref('')
const overrideSource = ref<{ type: 'channel' | 'playlist'; id: number; title: string } | null>(null)
const videoRuleOptions = computed(() => [
  { label: `Use ${overrideSource.value?.type ?? 'source'} setting`, value: 'inherit' },
  ...contentRuleOptions,
])
const overrideVideos = ref<any[]>([])
const overrideLoading = ref(false)
const recommendedVideoId = ref('')
const contentSearch = ref('')
const selectedTag = ref('')
const syncingId = ref('')
const allTags = computed(() => [...new Set([
  ...(data.value?.channels ?? []), ...(data.value?.playlists ?? []), ...(data.value?.videos ?? []),
].flatMap((item: any) => item.tags ?? []))].sort())
function matchesContent(item: any, title: string) {
  const query = contentSearch.value.trim().toLowerCase()
  return (!query || `${title} ${(item.tags ?? []).join(' ')}`.toLowerCase().includes(query))
    && (!selectedTag.value || item.tags?.includes(selectedTag.value))
}
const filteredChannels = computed(() => (data.value?.channels ?? []).filter((item: any) => matchesContent(item, item.channelTitle)))
const filteredPlaylists = computed(() => (data.value?.playlists ?? []).filter((item: any) => matchesContent(item, item.playlistTitle)))
const filteredVideos = computed(() => (data.value?.videos ?? []).filter((item: any) => matchesContent(item, `${item.videoTitle} ${item.channelTitle ?? ''}`)))

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

async function deleteContent(id: number, type: string) {
  if (!confirm('Remove this content from allowlist?')) return

  try {
    await apiFetch(`/api/admin/content/${id}?type=${type}`, { method: 'DELETE' })
    await refresh()
  } catch (e: any) {
    alert(e.response?.message || e.message || 'Failed to delete')
  }
}

async function updateRule(id: number, type: string, rule: string) {
  try {
    await apiFetch(`/api/admin/children/${childId}/content/${type}/${id}/rule`, { method: 'PUT', body: { rule } })
    await refresh()
  } catch (e: any) {
    alert(e.response?.message || e.message || 'Failed to update Content Rule')
  }
}

async function editTags(item: any, type: 'channel' | 'playlist' | 'video') {
  const value = prompt('Tags (comma separated, up to 8)', (item.tags ?? []).join(', '))
  if (value === null) return
  const tags = [...new Set(value.split(',').map(tag => tag.trim()).filter(Boolean))].slice(0, 8)
  await apiFetch(`/api/admin/children/${childId}/content/${type}/${item.id}/tags`, { method: 'PUT', body: { tags } })
  await refresh()
}

async function syncContent(item: any, type: 'channel' | 'playlist' | 'video') {
  syncingId.value = `${type}-${item.id}`
  try {
    await apiFetch(`/api/admin/children/${childId}/content/${type}/${item.id}/sync`, { method: 'POST' })
    await refresh()
    if (overrideSource.value?.type === type && overrideSource.value.id === item.id) await showVideoOverrides(type, item.id, type === 'channel' ? item.channelTitle : item.playlistTitle)
  } finally { syncingId.value = '' }
}

function syncLabel(item: any) {
  return item.lastFetchedAt ? `Synced ${new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(Math.round((new Date(item.lastFetchedAt).getTime() - Date.now()) / 3_600_000), 'hour')}` : 'Not synced yet'
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
  return data.value?.videoRules?.find((item: any) => item.videoId === videoId)?.contentRule || 'inherit'
}

async function recommendVideo(videoId: string) {
  await apiFetch(`/api/admin/children/${childId}/recommendations`, { method: 'POST', body: { videoId } })
  recommendedVideoId.value = videoId
}

async function updateVideoOverride(videoId: string, rule: string) {
  if (!overrideSource.value) return
  if (rule === 'inherit') await apiFetch(`/api/admin/children/${childId}/video-rules/${encodeURIComponent(videoId)}`, { method: 'DELETE' })
  else await apiFetch(`/api/admin/children/${childId}/video-rules/${encodeURIComponent(videoId)}`, {
    method: 'PUT', body: { rule, sourceType: overrideSource.value.type, sourceId: overrideSource.value.id },
  })
  await refresh()
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
    <div class="mb-5 flex items-center gap-3 border-b border-gray-200 pb-4">
      <NuxtLink to="/admin" class="flex min-h-11 min-w-11 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100" aria-label="Back to accounts">
        <UIcon name="i-heroicons-arrow-left" class="h-5 w-5" />
      </NuxtLink>
      <div>
        <p class="text-sm font-medium text-[#065fd4]">Child settings</p>
        <h1 class="text-2xl font-bold tracking-tight">{{ data?.child?.displayName || data?.child?.email }}</h1>
      </div>
    </div>

    <div class="mb-5 grid gap-4 lg:grid-cols-2">
      <UCard class="rounded-2xl ring-1 ring-gray-200">
        <template #header><h2 class="font-semibold">Child profile</h2></template>
        <form class="grid grid-cols-[auto_1fr] items-end gap-3" @submit.prevent="saveProfile">
          <UAvatar :src="profileForm.avatarUrl" :alt="profileForm.displayName || data?.child?.email" size="xl" />
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Display name"><UInput v-model="profileForm.displayName" required class="w-full" /></UFormField>
            <UFormField label="Avatar URL"><UInput v-model="profileForm.avatarUrl" type="url" class="w-full" /></UFormField>
          </div>
          <span />
          <UButton type="submit" size="sm" :loading="profileSaving" class="min-h-11 justify-self-end">Save profile</UButton>
        </form>
      </UCard>
      <UCard class="rounded-2xl ring-1 ring-gray-200">
        <template #header>
          <div><h2 class="font-semibold">Copy configuration</h2><p class="text-xs text-gray-500">Copies Approved Content, Content Rules, and tags only.</p></div>
        </template>
        <div class="flex items-end gap-3">
          <UFormField label="Copy from Child" class="flex-1"><USelect v-model="copySourceChildId" :items="copyOptions" class="w-full" placeholder="Select a Child" /></UFormField>
          <UButton :disabled="!copySourceChildId" :loading="copying" @click="copyContent">Copy</UButton>
        </div>
      </UCard>
    </div>

    <div class="grid gap-4 xl:grid-cols-2">
    <UCard class="rounded-2xl ring-1 ring-gray-200">
      <template #header>
        <div>
          <h2 class="text-lg font-semibold">Viewing allowances</h2>
          <p class="text-sm text-gray-500">Allowances reset at midnight in this Child's fixed time zone.</p>
        </div>
      </template>
      <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="saveTimeSettings">
        <UFormField label="Time zone" class="md:col-span-2">
          <USelect v-model="timeForm.timeZone" :items="timeZoneOptions" class="w-full" />
          <template #hint>Initially suggested from this browser: {{ detectedTimeZone }}</template>
        </UFormField>
        <UFormField label="Weekday Daily Allowance">
          <USelect v-model="timeForm.weekdayAllowanceMinutes" :items="allowanceOptions" class="w-full" />
        </UFormField>
        <UFormField label="Weekend Daily Allowance">
          <USelect v-model="timeForm.weekendAllowanceMinutes" :items="allowanceOptions" class="w-full" />
        </UFormField>
        <UFormField label="Safety Cap">
          <USelect v-model="timeForm.safetyCapMinutes" :items="allowanceOptions" class="w-full" />
          <template #hint>Daily maximum for content set to “Safety Cap only.”</template>
        </UFormField>
        <UFormField label="Viewing Window starts"><USelect v-model="timeForm.allowedStartMinute" :items="clockOptions" class="w-full" /></UFormField>
        <UFormField label="Viewing Window ends"><USelect v-model="timeForm.allowedEndMinute" :items="endClockOptions" class="w-full" /></UFormField>
        <UFormField label="Required Break"><USelect v-model="timeForm.breakAfterMinutes" :items="breakAfterOptions" class="w-full" /></UFormField>
        <UFormField label="Break duration"><USelect v-model="timeForm.breakDurationMinutes" :items="breakDurationOptions" :disabled="timeForm.breakAfterMinutes === 0" class="w-full" /></UFormField>
        <div class="flex items-end justify-end">
          <UButton type="submit" :loading="timeSaving">Save allowances</UButton>
        </div>
        <UAlert v-if="timeError" color="red" :title="timeError" class="md:col-span-2" />
        <UAlert v-else-if="timeSaved" color="green" title="Viewing allowances saved" class="md:col-span-2" />
        <p v-if="timeData?.viewingDay" class="text-sm text-gray-500 md:col-span-2">
          Current Viewing Day: {{ timeData.viewingDay.localDate }} ·
          {{ timeData.viewingDay.isWeekend ? 'weekend' : 'weekday' }} allowance:
          {{ timeData.viewingDay.allowanceMinutes }} minutes
        </p>
      </form>
    </UCard>

    <UCard class="rounded-2xl ring-1 ring-gray-200">
      <template #header>
        <div>
          <h2 class="text-lg font-semibold">Today's viewing</h2>
          <p class="text-sm text-gray-500">Viewing Day {{ watchTime?.viewingDay }}. Today's changes expire at local midnight.</p>
        </div>
      </template>
      <div v-if="watchTime" class="grid gap-4 sm:grid-cols-2">
        <UAlert v-if="watchTime.policy?.blocked" color="warning" :title="watchTime.policy.reason === 'viewing-pause' ? 'Viewing paused' : watchTime.policy.reason === 'required-break' ? 'Required Break active' : 'Outside Viewing Window'" class="sm:col-span-2" />
        <div class="rounded-xl bg-gray-50 p-4">
          <h3 class="font-semibold">Uses Daily Allowance</h3>
          <p class="mt-1 text-2xl font-bold">{{ watchTime.restricted.usedMinutes }} min used</p>
          <p class="text-sm text-gray-500">
            {{ watchTime.restricted.unlocked ? 'Unlocked for today' : `${watchTime.restricted.remainingMinutes} min remaining` }}
            <span v-if="watchTime.restricted.extensionMinutes"> · +{{ watchTime.restricted.extensionMinutes }} min today</span>
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <UButton v-for="minutes in [15, 30, 60]" :key="minutes" size="xs" class="min-h-11" variant="soft" :disabled="interventionSaving" @click="extendToday('restricted', minutes as 15 | 30 | 60)">+{{ minutes }} min</UButton>
            <UButton size="xs" class="min-h-11" :color="watchTime.restricted.unlocked ? 'gray' : 'primary'" :disabled="interventionSaving" @click="setRestrictedUnlock(!watchTime.restricted.unlocked)">
              {{ watchTime.restricted.unlocked ? 'Restore today’s limit' : 'Unlock for today' }}
            </UButton>
          </div>
        </div>
        <div class="rounded-xl bg-[#e8f0fe] p-4">
          <h3 class="font-semibold">Safety Cap only</h3>
          <p class="mt-1 text-2xl font-bold">{{ watchTime.exempt.usedMinutes }} min used</p>
          <p class="text-sm text-gray-500">
            {{ watchTime.exempt.remainingMinutes }} min remaining
            <span v-if="watchTime.exempt.extensionMinutes"> · +{{ watchTime.exempt.extensionMinutes }} min today</span>
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <UButton v-for="minutes in [15, 30, 60]" :key="minutes" size="xs" class="min-h-11" variant="soft" :disabled="interventionSaving" @click="extendToday('exempt', minutes as 15 | 30 | 60)">+{{ minutes }} min</UButton>
          </div>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-3 sm:col-span-2">
          <p class="text-sm text-gray-500">
            <span v-if="watchTime.policy?.breakCycleRemainingSeconds !== null">Next break in {{ Math.ceil(watchTime.policy.breakCycleRemainingSeconds / 60) }} min.</span>
            Pause applies to both usage buckets until local midnight.
          </p>
          <UButton :color="watchTime.policy?.reason === 'viewing-pause' ? 'neutral' : 'warning'" :disabled="interventionSaving" @click="setViewingPause(watchTime.policy?.reason !== 'viewing-pause')">
            {{ watchTime.policy?.reason === 'viewing-pause' ? 'Resume viewing' : 'Pause viewing today' }}
          </UButton>
        </div>
      </div>
      <p v-else class="text-sm text-gray-500">Loading today's usage…</p>
    </UCard>
    </div>

    <UCard class="my-5 rounded-2xl ring-1 ring-gray-200">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <div><h2 class="font-semibold">Daily Usage Summary</h2><p class="text-xs text-gray-500">Aggregate time only; no per-video history.</p></div>
          <USelect v-model="usageDays" :items="[{ label: '7 days', value: 7 }, { label: '30 days', value: 30 }]" class="w-28" />
        </div>
      </template>
      <div class="flex h-36 items-end gap-1 overflow-x-auto" aria-label="Daily usage chart">
        <div v-for="day in usage?.days" :key="day.viewingDay" class="flex min-w-4 flex-1 flex-col items-center justify-end gap-1" :title="`${day.viewingDay}: ${Math.round(day.totalSeconds / 60)} minutes`">
          <div class="w-full rounded-t bg-[#065fd4]" :style="{ height: `${Math.max(day.totalSeconds ? 4 : 1, Math.min(110, day.totalSeconds / 60))}px` }" />
          <span v-if="usageDays === 7" class="text-[10px] text-gray-500">{{ day.viewingDay.slice(5) }}</span>
        </div>
      </div>
    </UCard>

    <!-- Add Content Form -->
    <UCard class="my-5 rounded-2xl ring-1 ring-gray-200">
      <form @submit.prevent="addContent" class="flex flex-col gap-3 sm:flex-row">
        <UInput
          v-model="addUrl"
          placeholder="Paste YouTube URL (video, playlist, or channel)"
          aria-label="YouTube video, playlist, or channel URL"
          class="flex-1"
          required
        />
        <UButton type="submit" :loading="addLoading">
          Add
        </UButton>
      </form>
      <UAlert v-if="addError" color="red" :title="addError" class="mt-4" />
    </UCard>

    <div class="mb-4 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-gray-700">
      <p class="font-semibold text-gray-900">Viewing time for approved content</p>
      <p class="mt-1"><strong>Uses Daily Allowance</strong> reduces the weekday or weekend allowance while it plays.</p>
      <p><strong>Safety Cap only</strong> does not reduce that allowance, but playback stops when the Safety Cap is reached.</p>
    </div>

    <div class="mb-3 flex flex-wrap items-center gap-2">
      <UInput v-model="contentSearch" icon="i-heroicons-magnifying-glass" placeholder="Search Approved Content or tags" class="min-w-64 flex-1" />
      <UButton :variant="selectedTag ? 'soft' : 'solid'" color="neutral" @click="selectedTag = ''">All</UButton>
      <UButton v-for="tag in allTags" :key="tag" :variant="selectedTag === tag ? 'solid' : 'soft'" color="neutral" @click="selectedTag = tag">{{ tag }}</UButton>
    </div>

    <!-- Content Tabs -->
    <UTabs class="rounded-2xl bg-white p-3 ring-1 ring-gray-200 sm:p-5" :items="[
      { label: `Channels (${data?.channels?.length || 0})`, slot: 'channels' },
      { label: `Playlists (${data?.playlists?.length || 0})`, slot: 'playlists' },
      { label: `Videos (${data?.videos?.length || 0})`, slot: 'videos' },
    ]">
      <template #channels>
        <div v-if="!filteredChannels.length" class="text-center py-8 text-gray-500">
          No matching channels
        </div>
        <div v-else class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <UCard v-for="channel in filteredChannels" :key="channel.id" class="rounded-xl ring-1 ring-gray-200" :class="{ 'opacity-50': !channel.isAvailable }">
            <div class="flex items-center gap-3">
              <UAvatar :src="channel.channelThumbnail" :alt="channel.channelTitle" size="lg" />
              <div class="flex-1 min-w-0">
                <p class="font-medium truncate">{{ channel.channelTitle }}</p>
                <p v-if="!channel.isAvailable" class="text-xs text-red-500">Unavailable</p>
                <p class="text-xs text-gray-500">{{ syncLabel(channel) }}</p>
              </div>
            </div>
            <div v-if="channel.tags?.length" class="mt-2 flex flex-wrap gap-1"><UBadge v-for="tag in channel.tags" :key="tag" color="neutral" variant="soft">{{ tag }}</UBadge></div>
            <template #footer>
              <div class="flex flex-wrap items-center gap-2">
                <USelect :model-value="channel.contentRule" :items="contentRuleOptions" class="min-h-11 min-w-44" size="xs" @update:model-value="updateRule(channel.id, 'channel', String($event))" />
                <UButton variant="ghost" size="xs" class="min-h-11" @click="showVideoOverrides('channel', channel.id, channel.channelTitle)">Video overrides</UButton>
                <UButton variant="ghost" size="xs" class="min-h-11" :loading="syncingId === `channel-${channel.id}`" @click="syncContent(channel, 'channel')">Sync</UButton>
                <UButton variant="ghost" size="xs" class="min-h-11" @click="editTags(channel, 'channel')">Tags</UButton>
                <UButton color="neutral" variant="ghost" size="xs" class="min-h-11" icon="i-heroicons-trash" @click="deleteContent(channel.id, 'channel')">Remove</UButton>
              </div>
            </template>
          </UCard>
        </div>
      </template>

      <template #playlists>
        <div v-if="!filteredPlaylists.length" class="text-center py-8 text-gray-500">
          No matching playlists
        </div>
        <div v-else class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <UCard v-for="playlist in filteredPlaylists" :key="playlist.id" class="rounded-xl ring-1 ring-gray-200" :class="{ 'opacity-50': !playlist.isAvailable }">
            <img :src="playlist.playlistThumbnail" :alt="playlist.playlistTitle" class="zt-thumbnail mb-2" />
            <p class="font-medium truncate">{{ playlist.playlistTitle }}</p>
            <p v-if="!playlist.isAvailable" class="text-xs text-red-500">Unavailable</p>
            <p class="text-xs text-gray-500">{{ syncLabel(playlist) }}</p>
            <div v-if="playlist.tags?.length" class="mt-2 flex flex-wrap gap-1"><UBadge v-for="tag in playlist.tags" :key="tag" color="neutral" variant="soft">{{ tag }}</UBadge></div>
            <template #footer>
              <div class="flex flex-wrap items-center gap-2">
                <USelect :model-value="playlist.contentRule" :items="contentRuleOptions" class="min-h-11 min-w-44" size="xs" @update:model-value="updateRule(playlist.id, 'playlist', String($event))" />
                <UButton variant="ghost" size="xs" class="min-h-11" @click="showVideoOverrides('playlist', playlist.id, playlist.playlistTitle)">Video overrides</UButton>
                <UButton variant="ghost" size="xs" class="min-h-11" :loading="syncingId === `playlist-${playlist.id}`" @click="syncContent(playlist, 'playlist')">Sync</UButton>
                <UButton variant="ghost" size="xs" class="min-h-11" @click="editTags(playlist, 'playlist')">Tags</UButton>
                <UButton color="neutral" variant="ghost" size="xs" class="min-h-11" icon="i-heroicons-trash" @click="deleteContent(playlist.id, 'playlist')">Remove</UButton>
              </div>
            </template>
          </UCard>
        </div>
      </template>

      <template #videos>
        <div v-if="!filteredVideos.length" class="text-center py-8 text-gray-500">
          No matching videos
        </div>
        <div v-else class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <UCard v-for="video in filteredVideos" :key="video.videoId" class="rounded-xl ring-1 ring-gray-200" :class="{ 'opacity-50': !video.isAvailable }">
            <div class="relative">
              <img :src="video.videoThumbnail" :alt="video.videoTitle" class="zt-thumbnail" />
              <span v-if="video.duration" class="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 rounded">
                {{ formatDuration(video.duration) }}
              </span>
            </div>
            <p class="font-medium truncate mt-2">{{ video.videoTitle }}</p>
            <p class="text-sm text-gray-500 truncate">{{ video.channelTitle }}</p>
            <p v-if="video.publishedAt" class="text-sm text-gray-500">{{ formatPublishedDate(video.publishedAt) }}</p>
            <p v-if="!video.isAvailable" class="text-xs text-red-500">Unavailable</p>
            <p class="text-xs text-gray-500">{{ syncLabel(video) }}</p>
            <div v-if="video.tags?.length" class="mt-2 flex flex-wrap gap-1"><UBadge v-for="tag in video.tags" :key="tag" color="neutral" variant="soft">{{ tag }}</UBadge></div>
            <template #footer>
              <div class="flex flex-wrap items-center gap-2">
                <USelect :model-value="video.contentRule" :items="contentRuleOptions" class="min-h-11 min-w-44" size="xs" @update:model-value="updateRule(video.id, 'video', String($event))" />
                <UButton color="primary" variant="soft" size="xs" class="min-h-11" icon="i-heroicons-megaphone" @click="recommendVideo(video.videoId)">{{ recommendedVideoId === video.videoId ? 'Recommended' : 'Recommend again' }}</UButton>
                <UButton variant="ghost" size="xs" class="min-h-11" :loading="syncingId === `video-${video.id}`" @click="syncContent(video, 'video')">Sync</UButton>
                <UButton variant="ghost" size="xs" class="min-h-11" @click="editTags(video, 'video')">Tags</UButton>
                <UButton color="neutral" variant="ghost" size="xs" class="min-h-11" icon="i-heroicons-trash" @click="deleteContent(video.id, 'video')">Remove</UButton>
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
            <h2 class="font-semibold">Video-specific Content Rules</h2>
            <p class="text-sm text-gray-500">{{ overrideSource.title }} · These overrides do not create duplicate video cards.</p>
          </div>
          <UButton variant="ghost" @click="overrideSource = null">Close</UButton>
        </div>
      </template>
      <p v-if="overrideLoading">Loading videos…</p>
      <p v-else-if="!overrideVideos.length" class="text-gray-500">No videos are cached yet. Use Sync on the content card and try again.</p>
      <div v-else class="divide-y">
        <div v-for="video in overrideVideos" :key="video.videoId" class="flex items-center gap-3 py-3">
          <img :src="video.videoThumbnail" :alt="video.videoTitle" class="h-12 w-20 rounded object-cover" />
          <p class="flex-1 truncate">{{ video.videoTitle }}</p>
          <USelect :model-value="overrideFor(video.videoId)" :items="videoRuleOptions" class="min-h-11 min-w-48" size="xs" @update:model-value="updateVideoOverride(video.videoId, String($event))" />
          <UButton color="primary" variant="soft" icon="i-heroicons-megaphone" class="min-h-11" @click="recommendVideo(video.videoId)">{{ recommendedVideoId === video.videoId ? 'Recommended' : 'Recommend' }}</UButton>
        </div>
      </div>
    </UCard>
  </div>
</template>
