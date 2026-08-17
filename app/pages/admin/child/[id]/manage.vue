<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ApiError, apiFetch, useApi } from '../../../../../src/api'

const route = useRoute()
const childId = parseInt(route.params.id as string)

const { data, refresh } = useApi<any>(`/api/admin/children/${childId}/content`)
const { data: timeData, refresh: refreshTimeSettings } = useApi<any>(`/api/admin/children/${childId}/time-settings`)
const { data: watchTime, refresh: refreshWatchTime } = useApi<any>(`/api/admin/children/${childId}/watch-time`)

const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const timeForm = reactive({
  timeZone: detectedTimeZone,
  weekdayAllowanceMinutes: 60,
  weekendAllowanceMinutes: 120,
  safetyCapMinutes: 180,
})
const timeSaving = ref(false)
const timeError = ref('')
const timeSaved = ref(false)
const allowanceOptions = Array.from({ length: 97 }, (_, index) => ({ label: `${index * 15} minutes`, value: index * 15 }))
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
    <div class="mb-8 flex items-center gap-3 border-b border-gray-200 pb-5">
      <NuxtLink to="/admin">
        <UButton color="gray" variant="ghost" icon="i-heroicons-arrow-left" />
      </NuxtLink>
      <div>
        <p class="text-sm font-medium text-[#065fd4]">Child settings</p>
        <h1 class="text-2xl font-bold tracking-tight">{{ data?.child?.displayName || data?.child?.email }}</h1>
      </div>
    </div>

    <div class="grid gap-5 xl:grid-cols-2">
    <UCard class="rounded-2xl ring-1 ring-gray-200">
      <template #header>
        <div>
          <h2 class="text-lg font-semibold">Viewing allowances</h2>
          <p class="text-sm text-gray-500">Allowances reset at midnight in this Child's fixed time zone.</p>
        </div>
      </template>
      <form class="grid gap-4 sm:grid-cols-2" @submit.prevent="saveTimeSettings">
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
        <div class="rounded-xl bg-gray-50 p-4">
          <h3 class="font-semibold">Uses Daily Allowance</h3>
          <p class="mt-1 text-2xl font-bold">{{ watchTime.restricted.usedMinutes }} min used</p>
          <p class="text-sm text-gray-500">
            {{ watchTime.restricted.unlocked ? 'Unlocked for today' : `${watchTime.restricted.remainingMinutes} min remaining` }}
            <span v-if="watchTime.restricted.extensionMinutes"> · +{{ watchTime.restricted.extensionMinutes }} min today</span>
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <UButton v-for="minutes in [15, 30, 60]" :key="minutes" size="xs" variant="soft" :disabled="interventionSaving" @click="extendToday('restricted', minutes as 15 | 30 | 60)">+{{ minutes }} min</UButton>
            <UButton size="xs" :color="watchTime.restricted.unlocked ? 'gray' : 'primary'" :disabled="interventionSaving" @click="setRestrictedUnlock(!watchTime.restricted.unlocked)">
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
            <UButton v-for="minutes in [15, 30, 60]" :key="minutes" size="xs" variant="soft" :disabled="interventionSaving" @click="extendToday('exempt', minutes as 15 | 30 | 60)">+{{ minutes }} min</UButton>
          </div>
        </div>
      </div>
      <p v-else class="text-sm text-gray-500">Loading today's usage…</p>
    </UCard>
    </div>

    <!-- Add Content Form -->
    <UCard class="my-6 rounded-2xl ring-1 ring-gray-200">
      <form @submit.prevent="addContent" class="flex flex-col gap-3 sm:flex-row">
        <UInput
          v-model="addUrl"
          placeholder="Paste YouTube URL (video, playlist, or channel)"
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

    <!-- Content Tabs -->
    <UTabs class="rounded-2xl bg-white p-3 ring-1 ring-gray-200 sm:p-5" :items="[
      { label: `Channels (${data?.channels?.length || 0})`, slot: 'channels' },
      { label: `Playlists (${data?.playlists?.length || 0})`, slot: 'playlists' },
      { label: `Videos (${data?.videos?.length || 0})`, slot: 'videos' },
    ]">
      <template #channels>
        <div v-if="!data?.channels?.length" class="text-center py-8 text-gray-500">
          No channels added yet
        </div>
        <div v-else class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <UCard v-for="channel in data.channels" :key="channel.id" class="rounded-xl ring-1 ring-gray-200" :class="{ 'opacity-50': !channel.isAvailable }">
            <div class="flex items-center gap-3">
              <UAvatar :src="channel.channelThumbnail" :alt="channel.channelTitle" size="lg" />
              <div class="flex-1 min-w-0">
                <p class="font-medium truncate">{{ channel.channelTitle }}</p>
                <p v-if="!channel.isAvailable" class="text-xs text-red-500">Unavailable</p>
              </div>
            </div>
            <template #footer>
              <div class="flex flex-wrap items-center gap-2">
                <USelect :model-value="channel.contentRule" :items="contentRuleOptions" class="min-w-44" size="xs" @update:model-value="updateRule(channel.id, 'channel', String($event))" />
                <UButton variant="ghost" size="xs" @click="showVideoOverrides('channel', channel.id, channel.channelTitle)">Video overrides</UButton>
                <UButton color="neutral" variant="ghost" size="xs" icon="i-heroicons-trash" @click="deleteContent(channel.id, 'channel')">Remove</UButton>
              </div>
            </template>
          </UCard>
        </div>
      </template>

      <template #playlists>
        <div v-if="!data?.playlists?.length" class="text-center py-8 text-gray-500">
          No playlists added yet
        </div>
        <div v-else class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <UCard v-for="playlist in data.playlists" :key="playlist.id" class="rounded-xl ring-1 ring-gray-200" :class="{ 'opacity-50': !playlist.isAvailable }">
            <img :src="playlist.playlistThumbnail" :alt="playlist.playlistTitle" class="zt-thumbnail mb-2" />
            <p class="font-medium truncate">{{ playlist.playlistTitle }}</p>
            <p v-if="!playlist.isAvailable" class="text-xs text-red-500">Unavailable</p>
            <template #footer>
              <div class="flex flex-wrap items-center gap-2">
                <USelect :model-value="playlist.contentRule" :items="contentRuleOptions" class="min-w-44" size="xs" @update:model-value="updateRule(playlist.id, 'playlist', String($event))" />
                <UButton variant="ghost" size="xs" @click="showVideoOverrides('playlist', playlist.id, playlist.playlistTitle)">Video overrides</UButton>
                <UButton color="neutral" variant="ghost" size="xs" icon="i-heroicons-trash" @click="deleteContent(playlist.id, 'playlist')">Remove</UButton>
              </div>
            </template>
          </UCard>
        </div>
      </template>

      <template #videos>
        <div v-if="!data?.videos?.length" class="text-center py-8 text-gray-500">
          No videos added yet
        </div>
        <div v-else class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <UCard v-for="video in data.videos" :key="video.id" class="rounded-xl ring-1 ring-gray-200" :class="{ 'opacity-50': !video.isAvailable }">
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
            <template #footer>
              <div class="flex flex-wrap items-center gap-2">
                <USelect :model-value="video.contentRule" :items="contentRuleOptions" class="min-w-44" size="xs" @update:model-value="updateRule(video.id, 'video', String($event))" />
                <UButton color="primary" variant="soft" size="xs" icon="i-heroicons-megaphone" @click="recommendVideo(video.videoId)">{{ recommendedVideoId === video.videoId ? 'Recommended' : 'Recommend again' }}</UButton>
                <UButton color="neutral" variant="ghost" size="xs" icon="i-heroicons-trash" @click="deleteContent(video.id, 'video')">Remove</UButton>
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
      <p v-else-if="!overrideVideos.length" class="text-gray-500">No cached videos yet. Open this content once as the Child to refresh its membership.</p>
      <div v-else class="divide-y">
        <div v-for="video in overrideVideos" :key="video.videoId" class="flex items-center gap-3 py-3">
          <img :src="video.videoThumbnail" class="h-12 w-20 rounded object-cover" />
          <p class="flex-1 truncate">{{ video.videoTitle }}</p>
          <USelect :model-value="overrideFor(video.videoId)" :items="videoRuleOptions" class="min-w-48" size="xs" @update:model-value="updateVideoOverride(video.videoId, String($event))" />
          <UButton color="primary" variant="soft" icon="i-heroicons-megaphone" class="min-h-11" @click="recommendVideo(video.videoId)">{{ recommendedVideoId === video.videoId ? 'Recommended' : 'Recommend' }}</UButton>
        </div>
      </div>
    </UCard>
  </div>
</template>
