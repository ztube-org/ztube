<script setup lang="ts">
import { useRoute } from 'vue-router'
const route = useRoute()
</script>
<template>
  <nav class="zt-admin-nav" aria-label="Administration">
    <NuxtLink to="/admin" :aria-current="route.path === '/admin' || route.path.startsWith('/admin/child/') ? 'page' : undefined">Children</NuxtLink>
    <NuxtLink to="/admin/jellyfin" :aria-current="route.path === '/admin/jellyfin' ? 'page' : undefined">Jellyfin</NuxtLink>
    <NuxtLink to="/browse"><span class="sr-only sm:not-sr-only">Open viewer</span><UIcon name="i-heroicons-arrow-up-right" class="size-4" aria-hidden="true" /></NuxtLink>
  </nav>
</template>
