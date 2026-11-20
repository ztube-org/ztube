<script setup lang="ts">
import { computed, watch } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useApi, useAuth } from '../src/api'
import ThemeToggle from './components/ThemeToggle.vue'
import AdminNav from './components/AdminNav.vue'
import AccountMenu from './components/AccountMenu.vue'

const route = useRoute()
const isAdminPage = computed(() => route.path === '/admin' || route.path.startsWith('/admin/'))
const toaster = {
  position: 'bottom-right',
  duration: 4500,
  max: 3,
  progress: false,
  ui: { viewport: 'zt-toast-viewport', base: 'motion-reduce:animate-none motion-reduce:transition-none' },
} as const
const { user } = useAuth()
const { data: recommendations, refresh: refreshRecommendations } = useApi<{ count: number }>('/api/child/recommendations/count')
watch(() => route.fullPath, () => { void refreshRecommendations().catch(() => undefined) })
</script>

<template>
  <UApp :toaster="toaster">
    <RouterView v-if="route.meta.fullscreen" :key="route.fullPath" />
    <div v-else class="zt-app-shell min-h-screen">
      <header class="zt-app-header sticky top-0 z-40 border-b backdrop-blur">
        <div class="zt-header-row mx-auto flex min-h-14 max-w-[1600px] items-center justify-between gap-1 sm:gap-3">
          <RouterLink to="/" class="zt-brand flex min-h-11 min-w-11 shrink-0 items-center gap-2 rounded-lg text-lg font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2">
            <span class="zt-brand-mark flex h-7 w-9 items-center justify-center rounded-md text-white">
              <UIcon name="i-heroicons-play-solid" class="h-4 w-4" />
            </span>
            <span :class="{ 'sr-only sm:not-sr-only': isAdminPage }">ZTube</span>
          </RouterLink>
          <AdminNav v-if="isAdminPage" />
          <div v-if="user" class="flex shrink-0 items-center gap-1 sm:gap-3">
            <RouterLink v-if="!isAdminPage && recommendations?.count" to="/browse" class="zt-notification flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-semibold">
              <UIcon name="i-heroicons-megaphone" class="h-5 w-5" />
              <span class="hidden sm:inline">New for You ·</span> {{ recommendations.count }}
            </RouterLink>
            <AccountMenu />
          </div>
          <ThemeToggle v-else />
        </div>
      </header>
      <main class="zt-main mx-auto w-full max-w-[1600px]"><RouterView :key="route.path" /></main>
    </div>
  </UApp>
</template>
