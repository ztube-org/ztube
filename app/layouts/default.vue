<script setup lang="ts">
const { user, logout } = useAuth()
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <header class="bg-white dark:bg-gray-800 shadow">
      <div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
        <NuxtLink to="/" class="text-xl font-bold text-primary-500">
          ZTube
        </NuxtLink>

        <div v-if="user" class="flex items-center gap-4">
          <span class="text-sm text-gray-600 dark:text-gray-300">
            {{ user.username }}
          </span>
          <UButton color="gray" variant="ghost" @click="logout">
            Logout
          </UButton>
        </div>
      </div>
    </header>

    <main class="max-w-7xl mx-auto px-4 py-8">
      <slot />
    </main>
  </div>
</template>
