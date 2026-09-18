<script setup lang="ts">
import { computed } from 'vue'
import { usageChartScale } from '../../src/usage-chart'
const props = defineProps<{ days: { viewingDay: string; totalSeconds: number }[] }>()
const scale = computed(() => usageChartScale(props.days.map(day => day.totalSeconds)))
const labelEvery = computed(() => props.days.length <= 7 ? 1 : 5)
</script>

<template>
  <div>
    <p class="mb-2 text-xs text-gray-500">Minutes</p>
    <div class="relative ml-10 h-40 border-b border-l border-gray-300" role="img" aria-label="Daily watch time in minutes; exact values in daily totals below">
      <div v-for="tick in scale.ticks" :key="tick" class="pointer-events-none absolute inset-x-0 border-t border-gray-200" :style="{ bottom: `${tick / scale.ceiling * 100}%` }">
        <span class="absolute -left-11 -top-2 w-9 text-right text-[11px] text-gray-500">{{ tick }}</span>
      </div>
      <div class="absolute inset-0 flex items-end gap-1 px-1">
        <div v-for="day in days" :key="day.viewingDay" class="relative flex h-full min-w-0 flex-1 items-end">
          <div class="w-full rounded-t bg-[#065fd4]" :style="{ height: `${day.totalSeconds / 60 / scale.ceiling * 100}%` }" :title="`${day.viewingDay}: ${Math.floor(day.totalSeconds / 60)}m ${day.totalSeconds % 60}s`" />
        </div>
      </div>
    </div>
    <div class="ml-10 mt-1 flex gap-1 px-1" aria-hidden="true">
      <span v-for="(day, index) in days" :key="day.viewingDay" class="min-w-0 flex-1 text-center text-[10px] text-gray-500">{{ index % labelEvery === 0 || index === days.length - 1 ? day.viewingDay.slice(5) : '' }}</span>
    </div>
    <details class="mt-2 text-xs">
      <summary class="flex min-h-11 cursor-pointer items-center text-[#065fd4]">Show daily totals</summary>
      <div class="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        <div v-for="day in days" :key="day.viewingDay" class="flex justify-between gap-2"><span>{{ day.viewingDay }}</span><span>{{ Math.floor(day.totalSeconds / 60) }}m {{ day.totalSeconds % 60 }}s</span></div>
      </div>
    </details>
  </div>
</template>
