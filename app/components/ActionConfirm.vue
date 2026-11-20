<script lang="ts">
export type Confirmation = {
  title: string
  description: string
  label: string
  destructive?: boolean
  run: () => void | Promise<void>
}
</script>

<script setup lang="ts">
import { watch } from 'vue'

const action = defineModel<Confirmation | null>({ required: true })
let trigger: HTMLElement | null = null
watch(action, (value, previous) => {
  if (value && !previous) trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
}, { flush: 'sync' })

function restoreFocus(event: Event) {
  if (trigger?.isConnected) {
    event.preventDefault()
    trigger.focus()
  }
}

function runAction() {
  const confirmed = action.value
  action.value = null
  void confirmed?.run()
}
</script>

<template>
  <UModal :open="Boolean(action)" :title="action?.title" :description="action?.description"
    :close="false" :content="{ onCloseAutoFocus: restoreFocus }" :ui="{ content: 'max-w-md', footer: 'justify-end gap-2 p-3 sm:p-4' }"
    @update:open="!$event && (action = null)">
    <template #footer>
      <UButton class="min-h-11 min-w-11" color="neutral" variant="soft" autofocus @click="action = null">Cancel</UButton>
      <UButton class="min-h-11 min-w-11" :color="action?.destructive ? 'error' : 'primary'" @click="runAction">{{ action?.label }}</UButton>
    </template>
  </UModal>
</template>
