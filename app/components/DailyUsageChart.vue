<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { usageChartScale, type DailyWatchTotal } from '../../src/usage-chart'
import { shortViewingDate, watchDuration } from '../../src/viewing-events'

const props = defineProps<{ days: DailyWatchTotal[] }>()
const selectedDay = defineModel<string | null>('selectedDay', { required: true })
const scale = computed(() => usageChartScale(props.days.map(day => day.totalSeconds)))
const labelEvery = computed(() => props.days.length <= 7 ? 1 : 5)
const plot = ref<HTMLElement>()

onMounted(() => {
  if (plot.value) plot.value.scrollLeft = plot.value.scrollWidth
})

function toggleDay(day: string) {
  selectedDay.value = selectedDay.value === day ? null : day
}
</script>

<template>
  <div v-if="days.length" class="min-w-0 tabular-nums">
    <p class="mb-2 text-xs text-[var(--zt-muted)]">Minutes</p>
    <div class="flex">
      <div class="relative mr-2 h-36 w-7 shrink-0" aria-hidden="true">
        <span v-for="tick in scale.ticks" :key="tick" class="absolute right-0 translate-y-1/2 text-xs text-[var(--zt-muted)]" :style="{ bottom: `${tick / scale.ceiling * 100}%` }">{{ tick }}</span>
      </div>
      <div ref="plot" class="min-w-0 flex-1 overflow-x-auto pb-1" role="group" aria-label="Daily watch time by Viewing Day">
        <div class="relative grid" :style="{ minWidth: `${days.length * 44}px`, gridTemplateColumns: `repeat(${days.length}, minmax(44px, 1fr))` }">
          <div class="pointer-events-none absolute inset-x-0 top-0 h-36" aria-hidden="true">
            <div v-for="tick in scale.ticks" :key="tick" class="absolute inset-x-0 border-t" :style="{ bottom: `${tick / scale.ceiling * 100}%` }" />
          </div>
          <button
            v-for="(day, index) in days"
            :key="day.viewingDay"
            type="button"
            :aria-label="`${shortViewingDate(day.viewingDay)} · ${watchDuration(day.totalSeconds)} watched`"
            :aria-pressed="selectedDay === day.viewingDay"
            class="relative min-h-11 min-w-11 rounded-lg text-center text-xs text-[var(--zt-muted)] hover:bg-[var(--zt-blue-soft)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--zt-blue)] aria-pressed:bg-[var(--zt-blue-soft)] aria-pressed:font-semibold aria-pressed:text-[var(--zt-text)] aria-pressed:ring-2 aria-pressed:ring-[var(--zt-blue)] aria-pressed:ring-inset"
            @click="toggleDay(day.viewingDay)"
          >
            <span class="flex h-36 items-end justify-center" aria-hidden="true">
              <span class="w-3/5 max-w-12 rounded-t-md bg-[var(--zt-blue)]" :class="day.totalSeconds ? 'min-h-1' : 'min-h-0.5 opacity-30'" :style="{ height: `${day.totalSeconds / 60 / scale.ceiling * 100}%` }" />
            </span>
            <span class="flex h-8 items-center justify-center whitespace-nowrap" aria-hidden="true">
              {{ selectedDay === day.viewingDay || index % labelEvery === 0 || index === days.length - 1 ? shortViewingDate(day.viewingDay) : '' }}
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
  <p v-else class="text-sm text-[var(--zt-muted)]">No daily totals available.</p>
</template>
