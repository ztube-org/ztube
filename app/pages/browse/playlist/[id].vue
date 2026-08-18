<script setup lang="ts">
import { useRoute } from 'vue-router'
import SourceVideoPage from '../../../components/SourceVideoPage.vue'
const route = useRoute()
</script>

<template><SourceVideoPage kind="playlist" :source-id="String(route.params.id)" /></template>
