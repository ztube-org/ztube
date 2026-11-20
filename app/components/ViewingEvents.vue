<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from 'vue'
import { apiFetch } from '../../src/api'
import type { DailyWatchTotal } from '../../src/usage-chart'
import { groupViewingEvents, shortViewingDate, viewingDayLabel, watchDuration, type PlaybackViewingEvent, type ViewingEventsResponse } from '../../src/viewing-events'

const props = defineProps<{ childId: number; dailyTotals?: DailyWatchTotal[] }>()
const selectedDay = defineModel<string | null>('selectedDay', { required: true })
const allEvents = ref<ViewingEventsResponse>()
const filteredEvents = ref<ViewingEventsResponse>()
const filteredDay = ref<string | null>(null)
const page = computed(() => filteredDay.value ? filteredEvents.value : allEvents.value)
const timeZone = computed(() => page.value?.timeZone ?? allEvents.value?.timeZone ?? 'UTC')
const days = computed(() => groupViewingEvents(page.value?.events ?? [], timeZone.value))
const dailyTotals = computed(() => new Map(props.dailyTotals?.map(day => [day.viewingDay, day.totalSeconds])))
const clock = computed(() => new Intl.DateTimeFormat('en-US', { timeZone: timeZone.value, hour: 'numeric', minute: '2-digit' }))
const liveStatus = { playing: 'Playing', paused: 'Paused', buffering: 'Buffering' }
const loading = ref(false)
const error = ref('')
const expanded = reactive(new Set<string>())
const timeline = ref<HTMLElement>()
const idPrefix = useId()
let request: AbortController | undefined

function toggleVideo(key: string) {
  if (expanded.has(key)) expanded.delete(key)
  else expanded.add(key)
}

const time = (epoch: number) => clock.value.format(new Date(epoch * 1000))
function sessionWindow(session: PlaybackViewingEvent) {
  const start = time(session.startedAt)
  const end = time(session.lastWatchedAt)
  return start === end && session.lastWatchedAt - session.startedAt < 60 ? start : `${start} – ${end}`
}

async function loadEvents(day: string | null, more = false) {
  request?.abort()
  const controller = new AbortController()
  request = controller
  loading.value = true
  error.value = ''
  const target = day ? filteredEvents : allEvents
  const query = new URLSearchParams()
  if (day) query.set('day', day)
  if (more && target.value?.nextCursor) query.set('cursor', target.value.nextCursor)
  try {
    const suffix = query.size ? `?${query}` : ''
    const result = await apiFetch<ViewingEventsResponse>(`/api/admin/children/${props.childId}/viewing-events${suffix}`, { signal: controller.signal })
    if (controller.signal.aborted) return false
    target.value = more ? { ...result, events: [...(target.value?.events ?? []), ...result.events] } : result
    return true
  } catch (cause) {
    if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : 'Failed to load viewing events'
    return false
  } finally {
    if (request === controller) {
      request = undefined
      loading.value = false
    }
  }
}

async function scrollToDay(day: string) {
  await nextTick()
  if (selectedDay.value !== day) return
  const target = timeline.value?.querySelector(`[data-viewing-day="${day}"]`) ?? timeline.value?.querySelector('[data-day-filter]')
  target?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
}

async function showDay(day: string | null) {
  request?.abort()
  request = undefined
  loading.value = false
  error.value = ''
  filteredDay.value = null
  filteredEvents.value = undefined
  if (day === null) {
    if (!allEvents.value) await loadEvents(null)
    return
  }

  const loadedDays = days.value
  const complete = loadedDays.some(group => group.day === day) && (!allEvents.value?.nextCursor || loadedDays.at(-1)?.day !== day)
  if (!complete) {
    filteredDay.value = day
    await loadEvents(day)
  }
  await scrollToDay(day)
}

async function refresh() {
  const day = selectedDay.value
  const filter = filteredDay.value
  const refreshed = await loadEvents(filter)
  if (refreshed && day && selectedDay.value === day && !filter) await showDay(day)
}

watch(selectedDay, showDay)
onMounted(() => { void showDay(selectedDay.value) })
onBeforeUnmount(() => request?.abort())
</script>

<template>
  <UCard as="section" :aria-labelledby="`${idPrefix}-heading`" class="my-5 min-w-0 rounded-2xl ring-1 ring-[var(--zt-border)]">
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-x-3">
        <div>
          <h2 :id="`${idPrefix}-heading`" class="font-semibold">Viewing Events</h2>
          <p class="text-xs text-[var(--zt-muted)]">Last 30 days · {{ timeZone }}</p>
        </div>
        <UButton variant="ghost" class="min-h-11" :loading="loading" @click="refresh">Refresh</UButton>
      </div>
    </template>

    <div ref="timeline" class="min-w-0">
      <button
        v-if="filteredDay"
        data-day-filter
        type="button"
        class="mb-3 inline-flex min-h-11 max-w-full items-center gap-2 rounded-full bg-[var(--zt-blue-soft)] px-4 text-left text-sm font-medium text-[var(--zt-blue)] active:opacity-75"
        @click="selectedDay = null"
      >
        Showing {{ shortViewingDate(filteredDay) }} · Show all days
        <UIcon name="i-heroicons-x-mark" class="size-4 shrink-0" aria-hidden="true" />
      </button>

      <p v-if="error" role="alert" class="mb-3 text-sm text-[var(--zt-error)]">{{ error }}</p>
      <p v-if="loading && !page" role="status" class="text-sm text-[var(--zt-muted)]">Loading viewing events…</p>
      <p v-else-if="page && !days.length" role="status" class="text-sm text-[var(--zt-muted)]">
        {{ filteredDay ? `No viewing events or unlocks on ${shortViewingDate(filteredDay)}.` : 'No viewing events or unlocks in the last 30 days.' }}
      </p>

      <div v-if="days.length" class="space-y-4">
        <section
          v-for="day in days"
          :key="day.day"
          :data-viewing-day="day.day"
          class="overflow-hidden rounded-xl border"
          :class="selectedDay === day.day ? 'border-[var(--zt-blue)]' : 'border-[var(--zt-border)]'"
        >
          <header
            class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-3 py-2.5 sm:px-4"
            :class="selectedDay === day.day ? 'bg-[var(--zt-blue-soft)]' : 'bg-[var(--zt-surface-raised)]'"
          >
            <h3 class="text-sm font-semibold">{{ viewingDayLabel(day.day, timeZone) }}</h3>
            <p class="flex flex-wrap items-baseline gap-x-2 text-xs text-[var(--zt-muted)]">
              <strong class="tabular-nums text-[var(--zt-text)]">{{ watchDuration(dailyTotals.get(day.day) ?? day.watchedSeconds) }} watched</strong>
              <span v-if="day.watchedVideoCount">{{ day.watchedVideoCount }} {{ day.watchedVideoCount === 1 ? 'video' : 'videos' }}</span>
              <span v-if="day.unlockCount">{{ day.unlockCount }} {{ day.unlockCount === 1 ? 'unlock' : 'unlocks' }}</span>
            </p>
          </header>

          <ul role="list" class="divide-y divide-[var(--zt-border)]">
            <li v-for="(video, index) in day.videos" :key="video.videoId">
              <button
                type="button"
                :aria-expanded="expanded.has(`${day.day}/${video.videoId}`)"
                :aria-controls="`${idPrefix}-${day.day}-video-${index}`"
                class="flex min-h-11 w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--zt-surface-raised)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--zt-blue)] active:bg-[var(--zt-blue-soft)] sm:gap-3 sm:px-4"
                @click="toggleVideo(`${day.day}/${video.videoId}`)"
              >
                <span class="min-w-0 flex-1">
                  <span class="block break-words text-sm font-semibold">{{ video.title }}</span>
                  <span v-if="video.subtitle" class="block break-words text-xs text-[var(--zt-muted)]">{{ video.subtitle }}</span>
                  <span v-if="video.unlocks.length || video.sessions.length > 1" class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--zt-muted)]">
                    <span v-if="video.unlocks.length" class="rounded-full bg-[var(--zt-blue-soft)] px-2 py-0.5 font-medium text-[var(--zt-blue)]">Unlocked</span>
                    <span v-if="video.sessions.length > 1">{{ video.sessions.length }} sessions</span>
                  </span>
                </span>
                <span v-if="video.sessions.length" class="min-w-0 max-w-[38%] text-right">
                  <span class="block text-sm font-semibold tabular-nums">{{ watchDuration(video.watchedSeconds) }}</span>
                  <span class="block break-words text-xs text-[var(--zt-muted)]">{{ video.timePools.join(' · ') }}</span>
                </span>
                <UIcon :name="expanded.has(`${day.day}/${video.videoId}`) ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'" class="size-4 shrink-0 text-[var(--zt-muted)]" aria-hidden="true" />
              </button>
              <ul
                v-show="expanded.has(`${day.day}/${video.videoId}`)"
                :id="`${idPrefix}-${day.day}-video-${index}`"
                role="list"
                class="space-y-2 bg-[var(--zt-surface-raised)] px-3 py-3 text-xs text-[var(--zt-muted)] sm:px-4"
              >
                <li v-for="session in video.sessions" :key="session.sessionId" class="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                  <span class="tabular-nums">
                    {{ sessionWindow(session) }}
                    <span v-if="session.status !== 'ended'" class="ml-1 font-medium text-[var(--zt-blue)]">{{ liveStatus[session.status] }}</span>
                  </span>
                  <span class="font-medium tabular-nums text-[var(--zt-text)]">{{ watchDuration(session.watchedSeconds) }}</span>
                </li>
                <li v-for="unlock in video.unlocks" :key="unlock.unlockedAt" class="tabular-nums">Unlocked at {{ time(unlock.unlockedAt) }}</li>
              </ul>
            </li>
          </ul>
        </section>
      </div>
      <UButton v-if="page?.nextCursor" variant="soft" class="mt-3 min-h-11" :loading="loading" @click="loadEvents(filteredDay, true)">
        {{ filteredDay ? 'Load more events' : 'Load older events' }}
      </UButton>
    </div>
  </UCard>
</template>
