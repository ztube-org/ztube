<script setup lang="ts">
import { useRoute } from 'vue-router'
const route = useRoute()
</script>
<template>
  <nav class="zt-admin-nav" aria-label="Administration">
    <NuxtLink to="/admin" :aria-current="route.path === '/admin' || route.path.startsWith('/admin/child/') ? 'page' : undefined">Children</NuxtLink>
    <NuxtLink to="/admin/jellyfin" :aria-current="route.path === '/admin/jellyfin' ? 'page' : undefined">Jellyfin library</NuxtLink>
    <NuxtLink to="/browse" class="ml-auto">Open viewer <UIcon name="i-heroicons-arrow-up-right" /></NuxtLink>
  </nav>
</template>
