<script setup lang="ts">
import { useApi } from '../../../src/api'

const { data: childrenData } = useApi<any>('/api/admin/children')
</script>

<template>
  <div class="zt-page">
    <div class="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="mb-1 text-sm font-medium text-[#065fd4]">Admin dashboard</p>
        <h1 class="text-3xl font-bold tracking-tight">Accounts</h1>
        <p class="mt-2 text-sm text-gray-500">Accounts appear here automatically after their first sign-in.</p>
      </div>
      <NuxtLink to="/browse">
        <UButton icon="i-heroicons-play-solid">Open viewer</UButton>
      </NuxtLink>
    </div>

    <div class="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      <UCard v-for="child in childrenData?.children" :key="child.id" class="overflow-hidden rounded-2xl ring-1 ring-gray-200 transition hover:shadow-md">
        <template #header>
          <div class="flex items-center gap-3">
            <UAvatar :alt="child.displayName || child.email" size="lg" />
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h3 class="truncate font-semibold">{{ child.displayName || child.email }}</h3>
                <UBadge v-if="child.isAdmin" color="primary" variant="soft">Admin</UBadge>
              </div>
              <p class="truncate text-sm text-gray-500">{{ child.email }}</p>
            </div>
          </div>
        </template>

        <div class="grid grid-cols-3 divide-x divide-gray-200 text-center text-sm">
          <span><strong class="block text-lg text-[#0f0f0f]">{{ child.stats.channels }}</strong><span class="text-[#606060]">channels</span></span>
          <span><strong class="block text-lg text-[#0f0f0f]">{{ child.stats.playlists }}</strong><span class="text-[#606060]">playlists</span></span>
          <span><strong class="block text-lg text-[#0f0f0f]">{{ child.stats.videos }}</strong><span class="text-[#606060]">videos</span></span>
        </div>

        <template #footer>
          <NuxtLink :to="`/admin/child/${child.id}/manage`">
            <UButton block variant="soft">Manage Content</UButton>
          </NuxtLink>
        </template>
      </UCard>
    </div>
  </div>
</template>
