<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { apiFetch, useApi } from '../../../../../src/api'
import DailyUsageChart from '../../../../components/DailyUsageChart.vue'
import ViewingEvents from '../../../../components/ViewingEvents.vue'
import TimePoolManager from '../../../../components/TimePoolManager.vue'
import type { TimePoolsResponse, TimePoolBinding } from '../../../../../src/domain'
import AdminNav from '../../../../components/AdminNav.vue'
import CartoonPoolSettings from '../../../../components/CartoonPoolSettings.vue'
import { useAdminViewing } from '../../../../composables/use-admin-viewing'

const route = useRoute()
const childId = parseInt(route.params.id as string)

const { data, refresh } = useApi<any>(`/api/admin/children/${childId}/content`)
const { data: childrenData } = useApi<any>('/api/admin/children')
const {
  timeData, watchTime, usageDays, usage, usageError, usageLoading, refreshUsage, detectedTimeZone, timeForm, timeSaving, timeError, timeSaved,
  clockOptions, endClockOptions, breakAfterOptions, breakDurationOptions, timeZoneOptions,
  saveTimeSettings, interventionSaving, setViewingPause,
} = useAdminViewing(childId)
const poolData = ref<TimePoolsResponse | null>(null)
const contentRuleOptions = computed(() => (poolData.value?.pools ?? []).map(pool => ({ label: pool.name, value: pool.id })))
function boundPool(kind: TimePoolBinding['kind'], contentId: string, legacyKey = 'restricted') {
  return poolData.value?.bindings.find(b => b.kind === kind && b.contentId === contentId)?.poolId
    ?? poolData.value?.pools.find(pool => pool.legacyKey === legacyKey)?.id
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
  if (!copySourceChildId.value || !confirm('Copy Approved Content, Cartoon Pool membership, default pool choices, and tags from this Child? Existing matching items will be updated. The target Child’s Time Pools and unlock requirements apply; source custom Pool Bindings and budgets are not copied. Review the target pools after copying.')) return
  copying.value = true
  try {
    await apiFetch(`/api/admin/children/${childId}/content/copy`, { method: 'POST', body: { sourceChildId: copySourceChildId.value } })
    await refresh()
  } finally { copying.value = false }
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
const visiblePlaylists = computed(() => (data.value?.playlists ?? []).filter((item: any) => !item.playlistId?.startsWith('pl:')))
const jellyfinPlaylists = computed(() => (data.value?.playlists ?? []).filter((item: any) => item.playlistId?.startsWith('pl:jf:')))
const visibleVideos = computed(() => (data.value?.videos ?? []).filter((item: any) => !item.videoId?.startsWith('ol:') && !item.videoId?.startsWith('jf:')))
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

async function deleteContent(id: number, type: string) {
  if (!confirm('Remove this content from allowlist?')) return

  try {
    await apiFetch(`/api/admin/content/${id}?type=${type}`, { method: 'DELETE' })
    await refresh()
  } catch (e: any) {
    alert(e.response?.message || e.message || 'Failed to delete')
  }
}

async function updatePoolBinding(contentId: string, kind: TimePoolBinding['kind'], poolId: string | null) {
  try {
    await apiFetch(`/api/admin/children/${childId}/time-pool-bindings`, { method: 'PUT', body: { kind, contentId, poolId } })
    poolData.value = await apiFetch<TimePoolsResponse>(`/api/admin/children/${childId}/time-pools`)
    await refresh()
  } catch (cause) { alert(cause instanceof Error ? cause.message : 'Failed to update time pool') }
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
  if (item.playlistId?.startsWith('pl:jf:')) return item.lastFetchedAt ? `Jellyfin · Updated ${new Date(item.lastFetchedAt).toLocaleDateString()}` : 'Jellyfin library'
  if (item.playlistId?.startsWith('pl:')) return 'Archived playlist'
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
    <AdminNav />
    <div class="mb-5 flex items-center gap-3 border-b border-gray-200 pb-4">
      <NuxtLink to="/admin" class="flex min-h-11 min-w-11 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100" aria-label="Back to accounts">
        <UIcon name="i-heroicons-arrow-left" class="h-5 w-5" />
      </NuxtLink>
      <div>
        <p class="text-sm font-medium text-[#065fd4]">Child settings</p>
        <h1 class="text-2xl font-bold tracking-tight">{{ data?.child?.displayName || data?.child?.email }}</h1>
      </div>
    </div>

    <div class="zt-admin-tabs" role="tablist" aria-label="Child settings">
      <button v-for="item in sections" :id="`tab-${item.id}`" :key="item.id" role="tab" :aria-selected="section === item.id" :aria-controls="`panel-${item.id}`" @click="section = item.id">{{ item.label }}</button>
    </div>
    <section v-show="section === 'profile'" id="panel-profile" role="tabpanel" aria-labelledby="tab-profile">

    <div class="mt-3 grid gap-4 lg:grid-cols-2">
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
          <div><h2 class="font-semibold">Copy Approved Content</h2><p class="text-xs text-gray-500">Copies approvals, Cartoon Pool membership, default pool choices, and tags. The target Child’s Time Pools and unlock requirements apply; custom Pool Bindings and budgets are not copied.</p></div>
        </template>
        <div class="flex items-end gap-3">
          <UFormField label="Copy from Child" class="flex-1"><USelect v-model="copySourceChildId" :items="copyOptions" class="w-full" placeholder="Select a Child" /></UFormField>
          <UButton :disabled="!copySourceChildId" :loading="copying" @click="copyContent">Copy</UButton>
        </div>
      </UCard>
    </div>

    </section>
    <section v-show="section === 'time'" id="panel-time" role="tabpanel" aria-labelledby="tab-time">

    <div v-if="watchTime" class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--zt-border)] px-3 py-2"><div><p class="font-medium">Today · {{ watchTime.viewingDay }}</p><p class="text-sm text-[var(--zt-muted)]">{{ watchTime.policy?.reason === 'viewing-pause' ? 'Viewing is paused' : 'Pause stops playback across all time pools' }}</p></div><UButton :color="watchTime.policy?.reason === 'viewing-pause' ? 'neutral' : 'warning'" :disabled="interventionSaving" @click="setViewingPause(watchTime.policy?.reason !== 'viewing-pause')">{{ watchTime.policy?.reason === 'viewing-pause' ? 'Resume viewing' : 'Pause viewing today' }}</UButton></div>
    <TimePoolManager :child-id="childId" @loaded="poolData = $event" />
    <details class="mb-4 rounded-xl border border-[var(--zt-border)] px-3"><summary class="min-h-12 cursor-pointer content-center font-medium">Unlock credits</summary><CartoonPoolSettings :child-id="childId" :pools="poolData?.pools ?? []" :playlists="data?.playlists ?? []" /></details>

    <details class="mb-4 rounded-xl border border-[var(--zt-border)] px-3"><summary class="min-h-12 cursor-pointer content-center font-medium">Viewing hours &amp; breaks</summary>
    <div class="grid gap-4">
    <UCard class="rounded-2xl ring-1 ring-gray-200">
      <template #header>
        <div>
          <h2 class="text-lg font-semibold">Viewing routine</h2>
          <p class="text-sm text-gray-500">Viewing hours and breaks apply across every time pool.</p>
        </div>
      </template>
      <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="saveTimeSettings">
        <UFormField label="Time zone" class="md:col-span-2">
          <USelect v-model="timeForm.timeZone" :items="timeZoneOptions" class="w-full" />
          <template #hint>Initially suggested from this browser: {{ detectedTimeZone }}</template>
        </UFormField>
        <UFormField label="Viewing Window starts"><USelect v-model="timeForm.allowedStartMinute" :items="clockOptions" class="w-full" /></UFormField>
        <UFormField label="Viewing Window ends"><USelect v-model="timeForm.allowedEndMinute" :items="endClockOptions" class="w-full" /></UFormField>
        <UFormField label="Required Break"><USelect v-model="timeForm.breakAfterMinutes" :items="breakAfterOptions" class="w-full" /></UFormField>
        <UFormField label="Break duration"><USelect v-model="timeForm.breakDurationMinutes" :items="breakDurationOptions" :disabled="timeForm.breakAfterMinutes === 0" class="w-full" /></UFormField>
        <div class="flex items-end justify-end">
          <UButton type="submit" :loading="timeSaving">Save viewing routine</UButton>
        </div>
        <UAlert v-if="timeError" color="red" :title="timeError" class="md:col-span-2" />
        <UAlert v-else-if="timeSaved" color="green" title="Viewing routine saved" class="md:col-span-2" />
        <p v-if="timeData?.viewingDay" class="text-sm text-gray-500 md:col-span-2">
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
    <section class="my-5 rounded-xl border border-[var(--zt-border)] p-3" aria-label="Child Jellyfin access">
      <h3 class="font-semibold">Jellyfin</h3><p v-if="!jellyfinPlaylists.length" class="py-2 text-sm text-[var(--zt-muted)]">No shared series. Choose this child in the Jellyfin library to grant access.</p>
      <div v-for="item in jellyfinPlaylists" :key="item.id" class="flex items-center justify-between gap-3 border-t border-[var(--zt-border)] py-2"><div class="min-w-0"><p class="font-medium">{{ item.playlistTitle }}</p><p class="text-sm text-[var(--zt-muted)]">{{ item.cartoonPool ? 'Uses the cartoon library time pool and unlock credits' : 'Approved for this child' }}</p></div><UButton color="neutral" variant="ghost" @click="deleteContent(item.id, 'playlist')">Remove access</UButton></div>
    </section>
    <h3 class="text-lg font-semibold">YouTube</h3>
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

    <div class="mb-4 text-sm text-[var(--zt-muted)]">
      <p class="font-semibold text-gray-900">Viewing time for approved content</p>
      <p class="mt-1">Choose a time pool for each channel, playlist, or video. Video bindings take priority over playlists, then channels. Conflicting bindings at the same level require an explicit video binding.</p>
    </div>

    <div class="mb-3 flex flex-wrap items-center gap-2">
      <UInput v-model="contentSearch" icon="i-heroicons-magnifying-glass" placeholder="Search Approved Content or tags" class="min-w-64 flex-1" />
      <UButton :variant="selectedTag ? 'soft' : 'solid'" color="neutral" @click="selectedTag = ''">All</UButton>
      <UButton v-for="tag in allTags" :key="tag" :variant="selectedTag === tag ? 'solid' : 'soft'" color="neutral" @click="selectedTag = tag">{{ tag }}</UButton>
    </div>

    <!-- Content Tabs -->
    <UTabs class="rounded-2xl bg-white p-3 ring-1 ring-gray-200 sm:p-5" :items="[
      { label: `Channels (${data?.channels?.length || 0})`, slot: 'channels' },
      { label: `Playlists (${visiblePlaylists.length})`, slot: 'playlists' },
      { label: `Videos (${visibleVideos.length})`, slot: 'videos' },
    ]">
      <template #channels>
        <div v-if="!filteredChannels.length" class="text-center py-8 text-gray-500">
          No matching channels
        </div>
        <div v-else class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
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
                <USelect :model-value="boundPool('channel', channel.channelId, channel.contentRule)" :aria-label="`Time pool for ${channel.channelTitle}`" :items="contentRuleOptions" class="min-h-11 min-w-44" size="xs" @update:model-value="updatePoolBinding(channel.channelId, 'channel', String($event))" />
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
        <div v-else class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <UCard v-for="playlist in filteredPlaylists" :key="playlist.id" class="rounded-xl ring-1 ring-gray-200" :class="{ 'opacity-50': !playlist.isAvailable }">
            <img :src="playlist.playlistThumbnail" :alt="playlist.playlistTitle" class="mb-2 h-20 w-36 rounded-lg object-cover" />
            <p class="font-medium truncate">{{ playlist.playlistTitle }}</p>
            <p v-if="!playlist.isAvailable" class="text-xs text-red-500">Unavailable</p>
            <p class="text-xs text-gray-500">{{ syncLabel(playlist) }}</p>
            <div v-if="playlist.tags?.length" class="mt-2 flex flex-wrap gap-1"><UBadge v-for="tag in playlist.tags" :key="tag" color="neutral" variant="soft">{{ tag }}</UBadge></div>
            <template #footer>
              <div class="flex flex-wrap items-center gap-2">
                <USelect :model-value="boundPool('playlist', playlist.playlistId, playlist.contentRule)" :aria-label="`Time pool for ${playlist.playlistTitle}`" :items="contentRuleOptions" class="min-h-11 min-w-44" size="xs" @update:model-value="updatePoolBinding(playlist.playlistId, 'playlist', String($event))" />
                <UButton variant="ghost" size="xs" class="min-h-11" @click="showVideoOverrides('playlist', playlist.id, playlist.playlistTitle)">Video overrides</UButton>
                <UButton v-if="playlist.playlistId?.startsWith('pl:jf:')" to="/admin/jellyfin" variant="ghost" class="min-h-11">Edit Playlist</UButton>
                <UButton v-else variant="ghost" size="xs" class="min-h-11" :loading="syncingId === `playlist-${playlist.id}`" @click="syncContent(playlist, 'playlist')">Sync</UButton>
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
        <div v-else class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <UCard v-for="video in filteredVideos" :key="video.videoId" class="rounded-xl ring-1 ring-gray-200" :class="{ 'opacity-50': !video.isAvailable }">
            <div class="relative">
              <img :src="video.videoThumbnail" :alt="video.videoTitle" class="h-20 w-36 rounded-lg object-cover" />
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
                <USelect :model-value="boundPool('video', video.videoId, video.contentRule)" :aria-label="`Time pool for ${video.videoTitle}`" :items="contentRuleOptions" class="min-h-11 min-w-44" size="xs" @update:model-value="updatePoolBinding(video.videoId, 'video', String($event))" />
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
            <h2 class="font-semibold">Video-specific time pools</h2>
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

    </section>
    <section v-show="section === 'activity'" id="panel-activity" role="tabpanel" aria-labelledby="tab-activity">
    <UCard class="my-5 rounded-2xl ring-1 ring-gray-200">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <div><h2 class="font-semibold">Daily Usage Summary</h2><p class="text-xs text-gray-500">Total watch time by day, in minutes.</p></div>
          <USelect v-model="usageDays" :items="[{ label: '7 days', value: 7 }, { label: '30 days', value: 30 }]" class="min-h-11 w-28" />
        </div>
      </template>
      <p v-if="usageError" role="alert" class="text-sm text-red-600">{{ usageError }} <UButton variant="ghost" class="min-h-11" @click="refreshUsage">Retry</UButton></p>
      <p v-else-if="usageLoading" class="text-sm text-gray-500">Loading usage…</p>
      <DailyUsageChart v-else-if="usage" :days="usage.days" />
    </UCard>
    <ViewingEvents :key="childId" :child-id="childId" />
    </section>

  </div>
</template>
