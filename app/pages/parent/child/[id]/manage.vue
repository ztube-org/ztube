<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { apiFetch, useApi } from '../../../../../src/api'

const route = useRoute()
const childId = parseInt(route.params.id as string)

const { data, refresh } = useApi<any>(`/api/parent/children/${childId}/content`)
const { data: timeData, refresh: refreshTimeSettings } = useApi<any>(`/api/parent/children/${childId}/time-settings`)

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
    await apiFetch(`/api/parent/children/${childId}/time-settings`, { method: 'PUT', body: timeForm })
    await refreshTimeSettings()
    timeSaved.value = true
  } catch (error) {
    timeError.value = error instanceof Error ? error.message : 'Failed to save time settings'
  } finally {
    timeSaving.value = false
  }
}

const activeTab = ref('channels')
const addUrl = ref('')
const addLoading = ref(false)
const addError = ref('')

async function addContent() {
  addError.value = ''
  addLoading.value = true

  try {
    await apiFetch('/api/parent/content/add', {
      method: 'POST',
      body: { childId, url: addUrl.value },
    })
    addUrl.value = ''
    await refresh()
  } catch (e: any) {
    addError.value = e.data?.message || 'Failed to add content'
  } finally {
    addLoading.value = false
  }
}

async function deleteContent(id: number, type: string) {
  if (!confirm('Remove this content from allowlist?')) return

  try {
    await apiFetch(`/api/parent/content/${id}?type=${type}`, { method: 'DELETE' })
    await refresh()
  } catch (e: any) {
    alert(e.data?.message || 'Failed to delete')
  }
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
</script>

<template>
  <div>
    <div class="flex items-center gap-4 mb-8">
      <NuxtLink to="/parent/dashboard">
        <UButton color="gray" variant="ghost" icon="i-heroicons-arrow-left" />
      </NuxtLink>
      <h1 class="text-2xl font-bold">
        {{ data?.child?.displayName || data?.child?.email }}'s Content
      </h1>
    </div>

    <UCard class="mb-8">
      <template #header>
        <div>
          <h2 class="text-lg font-semibold">Viewing allowances</h2>
          <p class="text-sm text-gray-500">Allowances reset at midnight in this Child's fixed time zone.</p>
        </div>
      </template>
      <form class="grid gap-4 md:grid-cols-2" @submit.prevent="saveTimeSettings">
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
        <UFormField label="Allowance-exempt Safety Cap">
          <USelect v-model="timeForm.safetyCapMinutes" :items="allowanceOptions" class="w-full" />
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

    <!-- Add Content Form -->
    <UCard class="mb-8">
      <form @submit.prevent="addContent" class="flex gap-4">
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

    <!-- Content Tabs -->
    <UTabs :items="[
      { label: `Channels (${data?.channels?.length || 0})`, slot: 'channels' },
      { label: `Playlists (${data?.playlists?.length || 0})`, slot: 'playlists' },
      { label: `Videos (${data?.videos?.length || 0})`, slot: 'videos' },
    ]">
      <template #channels>
        <div v-if="!data?.channels?.length" class="text-center py-8 text-gray-500">
          No channels added yet
        </div>
        <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
          <UCard v-for="channel in data.channels" :key="channel.id" :class="{ 'opacity-50': !channel.isAvailable }">
            <div class="flex items-center gap-3">
              <UAvatar :src="channel.channelThumbnail" :alt="channel.channelTitle" size="lg" />
              <div class="flex-1 min-w-0">
                <p class="font-medium truncate">{{ channel.channelTitle }}</p>
                <p v-if="!channel.isAvailable" class="text-xs text-red-500">Unavailable</p>
              </div>
            </div>
            <template #footer>
              <UButton color="red" variant="ghost" size="xs" @click="deleteContent(channel.id, 'channel')">
                Remove
              </UButton>
            </template>
          </UCard>
        </div>
      </template>

      <template #playlists>
        <div v-if="!data?.playlists?.length" class="text-center py-8 text-gray-500">
          No playlists added yet
        </div>
        <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
          <UCard v-for="playlist in data.playlists" :key="playlist.id" :class="{ 'opacity-50': !playlist.isAvailable }">
            <img :src="playlist.playlistThumbnail" :alt="playlist.playlistTitle" class="w-full aspect-video object-cover rounded mb-2" />
            <p class="font-medium truncate">{{ playlist.playlistTitle }}</p>
            <p v-if="!playlist.isAvailable" class="text-xs text-red-500">Unavailable</p>
            <template #footer>
              <UButton color="red" variant="ghost" size="xs" @click="deleteContent(playlist.id, 'playlist')">
                Remove
              </UButton>
            </template>
          </UCard>
        </div>
      </template>

      <template #videos>
        <div v-if="!data?.videos?.length" class="text-center py-8 text-gray-500">
          No videos added yet
        </div>
        <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
          <UCard v-for="video in data.videos" :key="video.id" :class="{ 'opacity-50': !video.isAvailable }">
            <div class="relative">
              <img :src="video.videoThumbnail" :alt="video.videoTitle" class="w-full aspect-video object-cover rounded" />
              <span v-if="video.duration" class="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1 rounded">
                {{ formatDuration(video.duration) }}
              </span>
            </div>
            <p class="font-medium truncate mt-2">{{ video.videoTitle }}</p>
            <p class="text-sm text-gray-500 truncate">{{ video.channelTitle }}</p>
            <p v-if="!video.isAvailable" class="text-xs text-red-500">Unavailable</p>
            <template #footer>
              <UButton color="red" variant="ghost" size="xs" @click="deleteContent(video.id, 'video')">
                Remove
              </UButton>
            </template>
          </UCard>
        </div>
      </template>
    </UTabs>
  </div>
</template>
