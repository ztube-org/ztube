<script setup lang="ts">
import { computed } from 'vue'
import { useTheme } from '../../src/theme'

const { theme, toggleTheme } = useTheme()
const label = computed(() => theme.value === 'dark' ? 'Switch to light mode' : 'Switch to dark mode')
</script>

<template>
  <UButton
    color="neutral"
    variant="ghost"
    size="sm"
    :icon="theme === 'dark' ? 'i-heroicons-sun' : 'i-heroicons-moon'"
    :aria-label="label"
    :title="label"
    class="zt-theme-toggle"
    @click="toggleTheme"
  />
</template>
