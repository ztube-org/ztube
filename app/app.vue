<script setup lang="ts">
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { useAuth } from '../src/api'

const route = useRoute()
const { user, logout } = useAuth()
</script>

<template>
  <RouterView v-if="route.meta.fullscreen" />
  <div v-else class="min-h-screen bg-[#f9f9f9]">
    <header class="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div class="mx-auto flex h-12 max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-5 lg:px-6">
        <RouterLink to="/" class="flex items-center gap-2 text-lg font-bold tracking-tight text-[#0f0f0f]">
          <span class="flex h-7 w-9 items-center justify-center rounded-md bg-[#065fd4] text-white">
            <UIcon name="i-heroicons-play-solid" class="h-4 w-4" />
          </span>
          ZTube
        </RouterLink>
        <div v-if="user" class="flex min-w-0 items-center gap-2 sm:gap-4">
          <span class="hidden max-w-64 truncate text-sm text-gray-600 sm:block">{{ user.displayName || user.email }}</span>
          <UButton color="neutral" variant="ghost" icon="i-heroicons-arrow-right-start-on-rectangle" @click="logout">Logout</UButton>
        </div>
      </div>
    </header>
    <main class="mx-auto w-full max-w-[1600px] px-4 py-4 sm:px-5 lg:px-6 lg:py-5"><RouterView /></main>
  </div>
</template>
