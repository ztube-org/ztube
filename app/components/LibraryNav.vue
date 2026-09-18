<script setup lang="ts">
import { useRoute } from 'vue-router'
const route = useRoute()
</script>

<template>
  <nav class="zt-library-nav" aria-label="Library sections">
    <NuxtLink to="/browse" :aria-current="route.path === '/browse' ? 'page' : undefined"><UIcon name="i-heroicons-play-circle" />YouTube</NuxtLink>
    <NuxtLink to="/cartoon-pool" :aria-current="route.path === '/cartoon-pool' ? 'page' : undefined"><UIcon name="i-heroicons-film" />Jellyfin</NuxtLink>
  </nav>
</template>
