<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ src?: string | null; title: string; kind?: 'video' | 'playlist'; compact?: boolean }>(), { kind: 'video' })
const failed = ref(false)
const loaded = ref(false)
watch(() => props.src, () => { failed.value = false; loaded.value = false })
const palettes = ['ocean', 'forest', 'plum', 'clay', 'slate']
const palette = computed(() => {
  let hash = 0
  for (const char of props.title) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return palettes[hash % palettes.length]
})
const coverTitle = computed(() => props.title.replace(/_+/g, ' '))
</script>

<template>
  <div class="media-artwork" :class="[`media-artwork--${palette}`, { 'media-artwork--compact': compact, 'zt-thumbnail': !compact }]" aria-hidden="true">
    <div v-if="!loaded" class="media-artwork__cover">
      <div class="media-artwork__orbit" />
      <svg class="media-artwork__symbol" viewBox="0 0 64 64" fill="none">
        <template v-if="kind === 'playlist'">
          <path d="M15 12h34M11 20h42" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          <rect x="7" y="28" width="50" height="30" rx="7" fill="currentColor" fill-opacity=".14" stroke="currentColor" stroke-width="2" />
          <path d="m28 36 12 7-12 7Z" fill="currentColor" />
        </template>
        <template v-else>
          <circle cx="32" cy="32" r="26" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity=".1" />
          <path d="m27 21 17 11-17 11Z" fill="currentColor" />
        </template>
      </svg>
      <div v-if="!compact" class="media-artwork__copy">
        <span class="media-artwork__label">{{ kind === 'playlist' ? 'Collection' : 'Watch & discover' }}</span>
        <span class="media-artwork__title">{{ coverTitle }}</span>
      </div>
    </div>
    <img v-if="src?.trim() && !failed" :key="src" :src="src" alt="" loading="lazy" class="media-artwork__image" :class="{ 'media-artwork__image--loaded': loaded }" @load="loaded = true" @error="failed = true; loaded = false" />
  </div>
</template>

<style scoped>
.media-artwork { position: relative; overflow: hidden; container-type: inline-size; background: var(--art-bg); color: var(--art-ink); }
.media-artwork--ocean { --art-bg: #c9e1e8; --art-ink: #204e63; --art-shape: #a3cdd8; }
.media-artwork--forest { --art-bg: #d6e3ce; --art-ink: #365741; --art-shape: #b4ccab; }
.media-artwork--plum { --art-bg: #e3d9eb; --art-ink: #62466f; --art-shape: #cdbadc; }
.media-artwork--clay { --art-bg: #f0ddc9; --art-ink: #80523a; --art-shape: #e6c3a3; }
.media-artwork--slate { --art-bg: #d6dfea; --art-ink: #3f526e; --art-shape: #b5c7dd; }
.media-artwork__cover { position: absolute; inset: 0; background-image: linear-gradient(135deg, rgb(255 255 255 / 22%), transparent 65%); }
.media-artwork__orbit { position: absolute; width: 80%; aspect-ratio: 1; right: -34%; top: -15%; border-radius: 50%; background: var(--art-shape); border: 1px solid rgb(255 255 255 / 35%); box-shadow: 0 0 0 18px rgb(255 255 255 / 12%), 0 0 0 19px rgb(255 255 255 / 22%); }
.media-artwork__symbol { position: absolute; width: 21%; right: 8%; top: 27%; opacity: .85; }
.media-artwork__copy { position: absolute; inset: 28% 33% 14% 7%; display: flex; flex-direction: column; justify-content: center; gap: .5rem; }
.media-artwork__label { font-size: clamp(.55rem, 3cqw, .7rem); font-weight: 600; text-transform: uppercase; letter-spacing: .13em; opacity: .8; }
.media-artwork__title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; overflow-wrap: anywhere; font-size: clamp(.875rem, 6cqw, 1.5rem); font-weight: 750; line-height: 1.16; letter-spacing: -.025em; }
.media-artwork__image { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0; }
.media-artwork__image--loaded { opacity: 1; }
.media-artwork--compact .media-artwork__symbol { width: 35%; top: 18%; right: 32.5%; }
:global(.dark) .media-artwork__cover { filter: brightness(.78) saturate(.85); }
</style>
