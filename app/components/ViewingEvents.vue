<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { apiFetch } from '../../src/api'
import type { ViewingEvent, ViewingEventsResponse } from '../../src/viewing-events'
const props = defineProps<{ childId: number }>()
const events = ref<ViewingEvent[]>([])
const nextCursor = ref<string | null>(null)
const timeZone = ref('UTC')
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
async function refresh(more = false) {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    const query = more && nextCursor.value ? `?cursor=${encodeURIComponent(nextCursor.value)}` : ''
    const data = await apiFetch<ViewingEventsResponse>(`/api/admin/children/${props.childId}/viewing-events${query}`)
    events.value = more ? [...events.value, ...data.events] : data.events
    nextCursor.value = data.nextCursor
    timeZone.value = data.timeZone
    loaded.value = true
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Failed to load viewing events' }
  finally { loading.value = false }
}
const timestamp = (epoch: number) => new Date(epoch * 1000).toLocaleString([], { timeZone: timeZone.value, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })
const duration = (seconds: number) => `${Math.floor(seconds / 60)}m ${seconds % 60}s`
onMounted(() => { void refresh() })
</script>

<template>
  <UCard class="my-5 rounded-2xl ring-1 ring-gray-200">
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <div><h2 class="font-semibold">Viewing Events</h2><p class="text-xs text-gray-500">Last 30 days · {{ timeZone }} · one record per playback session</p></div>
        <UButton variant="ghost" class="min-h-11" :loading="loading" @click="refresh()">Refresh</UButton>
      </div>
    </template>
    <p class="mb-3 text-xs text-gray-500">Watch time excludes pauses and buffering. Records update as playback is acknowledged. Recording begins with playback sessions started after this feature was enabled; earlier history is unavailable.</p>
    <p v-if="error" role="alert" class="mb-3 text-sm text-red-600">{{ error }}</p>
    <p v-if="loading && !loaded" role="status" class="text-sm text-gray-500">Loading viewing events…</p>
    <p v-else-if="loaded && !events.length" class="text-sm text-gray-500">No recorded viewing events in the last 30 days.</p>
    <ol class="divide-y divide-gray-200">
      <li v-for="event in events" :key="event.sessionId" class="flex items-start justify-between gap-4 py-3">
        <div class="min-w-0">
          <p class="break-words text-sm font-medium">{{ event.videoTitle }}</p>
          <p class="text-xs text-gray-500">{{ event.channelTitle || 'Video' }} · {{ event.videoId }}</p>
          <p class="mt-1 text-xs text-gray-600">Started {{ timestamp(event.startedAt) }}</p>
          <p class="text-xs text-gray-500">Last watched {{ timestamp(event.lastWatchedAt) }}</p>
        </div>
        <div class="shrink-0 text-right">
          <p class="text-sm font-semibold tabular-nums">{{ duration(event.watchedSeconds) }}</p>
          <p class="text-xs text-gray-500">{{ event.timePoolName ?? (event.usageBucket === 'cartoon' ? 'Cartoon Time' : event.usageBucket === 'exempt' ? 'Safety Cap' : 'Daily Allowance') }}</p>
          <p class="mt-1 text-xs capitalize text-gray-500">{{ event.status }}</p>
        </div>
      </li>
    </ol>
    <UButton v-if="nextCursor" variant="soft" class="mt-3 min-h-11" :loading="loading" @click="refresh(true)">Load older events</UButton>
  </UCard>
</template>
