import { createRouter, createWebHistory } from 'vue-router'
import { fetchCurrentUser } from './api'
import Home from '../app/pages/index.vue'
import AdminDashboard from '../app/pages/admin/index.vue'
import ManageChild from '../app/pages/admin/child/[id]/manage.vue'
import Browse from '../app/pages/browse/index.vue'
import Channel from '../app/pages/browse/channel/[id].vue'
import Playlist from '../app/pages/browse/playlist/[id].vue'
import Watch from '../app/pages/watch.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/admin', component: AdminDashboard, meta: { role: 'admin' } },
    { path: '/admin/child/:id/manage', component: ManageChild, meta: { role: 'admin' } },
    { path: '/browse', component: Browse },
    { path: '/browse/channel/:id', component: Channel },
    { path: '/browse/playlist/:id', component: Playlist },
    { path: '/watch', component: Watch, meta: { fullscreen: true } },
  ],
})

router.beforeEach(async to => {
  const user = await fetchCurrentUser()
  if (to.path === '/') return user.role === 'admin' ? '/admin' : '/browse'
  if (to.meta.role && to.meta.role !== user.role) return '/'
})
