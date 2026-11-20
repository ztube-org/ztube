<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ViewingStatus } from '../../src/domain'
import TimePoolPill from './TimePoolPill.vue'
const props = defineProps<{ status: ViewingStatus | null; error?: string; refreshing?: boolean }>()
defineEmits<{ refresh: [] }>()
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => clearInterval(timer))
const pools = computed(() => {
  const time = props.status?.watchTime
  if (!time) return []
  if (time.pools) return time.pools
  return [
    { ...time.restricted, id: 'restricted', name: 'Daily Allowance' },
    { ...time.exempt, id: 'exempt', name: 'Safety Cap' },
    ...(time.cartoon ? [{ ...time.cartoon, id: 'cartoon', name: 'Cartoon Time' }] : []),
  ]
})
const policyIcon = computed(() => {
  switch (props.status?.policy?.reason) {
    case 'required-break': return 'i-heroicons-clock'
    case 'outside-window': return 'i-heroicons-moon'
    default: return 'i-heroicons-pause-circle'
  }
})
const message = computed(() => {
  const policy = props.status?.policy
  if (policy?.reason === 'required-break' && policy.breakUntil) {
    const seconds = Math.max(0, Math.ceil((Date.parse(policy.breakUntil) - now.value) / 1000))
    return seconds ? `Time for a break · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} left` : 'Checking if your break is finished…'
  }
  if (policy?.reason === 'required-break') return 'Time for a break'
  if (policy?.reason === 'viewing-pause') return 'An Admin has paused watching for today'
  if (policy?.reason === 'outside-window') return policy.nextWindow
    ? `Watching opens ${policy.nextWindow.day} at ${policy.nextWindow.time} (${policy.nextWindow.timeZone})`
    : 'It is outside your viewing hours'
  return policy?.blocked ? 'Watching is unavailable right now' : ''
})
</script>

<template>
  <div class="zt-status-bar flex min-w-0 items-center gap-2">
    <div v-if="error" role="alert" class="min-w-0 flex-1 break-words text-sm text-[var(--zt-error)]">{{ error }}</div>
    <div v-else-if="status" class="zt-pill-strip flex-1" role="region" aria-label="Viewing time" tabindex="0">
      <span v-if="message" class="zt-viewing-pill" data-tone="warning">
        <UIcon :name="policyIcon" class="size-4 shrink-0" aria-hidden="true" />
        {{ message }}
      </span>
      <TimePoolPill v-for="pool in pools" :key="pool.id" :pool="pool" />
    </div>
    <span v-else class="flex-1 text-sm text-[var(--zt-muted)]">Checking viewing time…</span>
    <UButton variant="ghost" color="neutral" class="min-h-11 min-w-11 shrink-0 justify-center rounded-full"
      :loading="refreshing" icon="i-heroicons-arrow-path" aria-label="Refresh viewing time" @click="$emit('refresh')" />
  </div>
</template>
