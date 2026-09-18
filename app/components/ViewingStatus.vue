<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ViewingStatus } from '../../src/domain'
const props = defineProps<{ status: ViewingStatus | null; error?: string; refreshing?: boolean }>()
defineEmits<{ refresh: [] }>()
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => clearInterval(timer))
const message = computed(() => {
  const policy = props.status?.policy
  if (policy?.reason === 'required-break' && policy.breakUntil) {
    const seconds = Math.max(0, Math.ceil((Date.parse(policy.breakUntil) - now.value) / 1000))
    return seconds ? `Time for a break · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} left` : 'Checking if your break is finished…'
  }
  if (policy?.reason === 'viewing-pause') return 'An Admin has paused watching for today'
  if (policy?.reason === 'outside-window') return policy.nextWindow
    ? `Watching opens ${policy.nextWindow.day} at ${policy.nextWindow.time} (${policy.nextWindow.timeZone})`
    : 'It is outside your viewing hours'
  return policy?.blocked ? 'Watching is unavailable right now' : ''
})
</script>

<template>
  <div class="zt-status-bar flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[var(--zt-border)] py-1 text-sm">
    <div v-if="error" role="alert">{{ error }}</div>
    <div v-else-if="status" class="flex flex-wrap gap-x-4 gap-y-1">
      <span v-if="message" class="font-medium">{{ message }}</span>
      <template v-if="status.watchTime.pools"><span v-for="pool in status.watchTime.pools" :key="pool.id" class="text-[var(--zt-muted)]">{{ Math.ceil(pool.remainingSeconds / 60) }} min {{ pool.name }} left</span></template>
      <template v-else><span class="font-medium">{{ Math.ceil(status.watchTime.restricted.remainingSeconds / 60) }} min Daily Allowance left</span>
      <span class="text-[var(--zt-muted)]">{{ Math.ceil(status.watchTime.exempt.remainingSeconds / 60) }} min Safety Cap left</span>
      <span v-if="status.watchTime.cartoon" class="text-[var(--zt-muted)]">{{ Math.ceil(status.watchTime.cartoon.remainingSeconds / 60) }} min Cartoon Time left</span></template>
    </div>
    <span v-else class="text-[var(--zt-muted)]">Checking viewing time…</span>
    <UButton variant="ghost" color="neutral" :loading="refreshing" aria-label="Refresh viewing time" @click="$emit('refresh')"><UIcon name="i-heroicons-arrow-path" class="h-4 w-4" /><span class="sr-only">Check time</span></UButton>
  </div>
</template>
