import { cloudflare } from '@cloudflare/vite-plugin'
import vue from '@vitejs/plugin-vue'
import ui from '@nuxt/ui/vite'
import { defineConfig } from 'vite'

export default defineConfig({ plugins: [vue(), ui(), cloudflare()] })
