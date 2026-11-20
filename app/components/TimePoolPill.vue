<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  pool: {
    name?: string
    remainingSeconds: number
    locked: boolean
    usedSeconds?: number
    allowanceMinutes?: number
    extensionMinutes?: number
    unlocked?: boolean
  }
}>()

const balance = computed(() => Math.max(0, props.pool.remainingSeconds))
const allowance = computed(() => {
  if (props.pool.unlocked) return 86_400
  if (props.pool.allowanceMinutes !== undefined) return (props.pool.allowanceMinutes + (props.pool.extensionMinutes ?? 0)) * 60
  return props.pool.usedSeconds === undefined ? null : props.pool.usedSeconds + balance.value
})
const locked = computed(() => props.pool.locked || balance.value === 0)
const low = computed(() => !locked.value && balance.value <= 600)
</script>

<template>
  <span class="zt-viewing-pill" :data-tone="locked ? 'muted' : low ? 'warning' : 'accent'">
    <UIcon v-if="locked" name="i-heroicons-lock-closed" class="size-3.5 shrink-0" aria-hidden="true" />
    <span class="whitespace-nowrap">{{ Math.ceil(balance / 60) }} min {{ pool.name ? `${pool.name} ` : '' }}left</span>
    <meter v-if="allowance !== null" class="zt-pool-meter" :value="Math.min(Math.max(1, allowance), balance)"
      :max="Math.max(1, allowance)" aria-hidden="true" />
  </span>
</template>
