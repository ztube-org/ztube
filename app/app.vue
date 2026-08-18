<script setup lang="ts">
import { watch } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useApi, useAuth } from '../src/api'
import ThemeToggle from './components/ThemeToggle.vue'

const route = useRoute()
const { user, logout } = useAuth()
const { data: recommendations, refresh: refreshRecommendations } = useApi<{ count: number }>('/api/child/recommendations/count')
watch(() => route.fullPath, () => { void refreshRecommendations() })
</script>

<template>
  <RouterView v-if="route.meta.fullscreen" :key="route.fullPath" />
  <div v-else class="zt-app-shell min-h-screen">
    <header class="zt-app-header sticky top-0 z-40 border-b backdrop-blur">
      <div class="mx-auto flex h-12 max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-5 lg:px-6">
        <RouterLink to="/" class="zt-brand flex min-h-11 items-center gap-2 rounded-lg text-lg font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2">
          <span class="zt-brand-mark flex h-7 w-9 items-center justify-center rounded-md text-white">
            <UIcon name="i-heroicons-play-solid" class="h-4 w-4" />
          </span>
          ZTube
        </RouterLink>
        <div v-if="user" class="flex min-w-0 items-center gap-2 sm:gap-4">
          <RouterLink v-if="recommendations?.count" to="/browse" class="zt-notification flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-semibold">
            <UIcon name="i-heroicons-megaphone" class="h-5 w-5" />
            <span class="hidden sm:inline">New for You ·</span> {{ recommendations.count }}
          </RouterLink>
          <UAvatar :src="user.avatarUrl" :alt="user.displayName || user.email" size="sm" />
          <span class="hidden max-w-64 truncate text-sm text-gray-600 sm:block">{{ user.displayName || user.email }}</span>
          <ThemeToggle />
          <UButton color="neutral" variant="ghost" icon="i-heroicons-arrow-right-start-on-rectangle" aria-label="Logout" @click="logout"><span class="hidden sm:inline">Logout</span></UButton>
        </div>
        <ThemeToggle v-else />
      </div>
    </header>
    <main class="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-5 lg:px-6 lg:py-5"><RouterView /></main>
  </div>
</template>
