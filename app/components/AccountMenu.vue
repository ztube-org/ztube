<script setup lang="ts">
import { computed } from 'vue'
import { useAuth } from '../../src/api'
import { useTheme } from '../../src/theme'
const { user, logout } = useAuth()
const { theme, toggleTheme } = useTheme()
const items = computed(() => [
  { label: user.value?.displayName || user.value?.email || 'Account', type: 'label' as const },
  { label: theme.value === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', icon: theme.value === 'dark' ? 'i-heroicons-sun' : 'i-heroicons-moon', onSelect: toggleTheme },
  { label: 'Logout', icon: 'i-heroicons-arrow-right-start-on-rectangle', onSelect: logout },
])
</script>
<template>
  <UDropdownMenu :items="items" :content="{ align: 'end' }">
    <UButton color="neutral" variant="ghost" class="min-h-11 min-w-11 justify-center rounded-full" aria-label="Account menu">
      <UAvatar :src="user?.avatarUrl || undefined" :alt="user?.displayName || 'Account'" size="sm" aria-hidden="true" />
    </UButton>
  </UDropdownMenu>
</template>
