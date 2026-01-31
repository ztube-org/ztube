export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: ['@nuxt/ui'],

  runtimeConfig: {
    superadminPassword: process.env.SUPERADMIN_PASSWORD || '',
    invitationCode: process.env.INVITATION_CODE || '',
    youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
    sessionPassword: process.env.NUXT_SESSION_PASSWORD || '',
  },

  nitro: {
    preset: 'cloudflare-pages',
  },

  future: {
    compatibilityVersion: 4,
  },
})
