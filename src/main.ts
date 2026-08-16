import { createApp } from 'vue'
import { RouterLink } from 'vue-router'
import NuxtUI from '@nuxt/ui/vue-plugin'
import App from '../app/app.vue'
import { router } from './router'
import './style.css'

const app = createApp(App)
app.use(router)
app.use(NuxtUI)
app.component('NuxtLink', RouterLink)
app.mount('#app')
