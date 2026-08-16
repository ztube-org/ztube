import { createRouter, createWebHistory } from 'vue-router'
import { fetchCurrentUser } from './api'
import Home from '../app/pages/index.vue'
import Admin from '../app/pages/admin/index.vue'
import ParentDashboard from '../app/pages/parent/dashboard.vue'
import ManageChild from '../app/pages/parent/child/[id]/manage.vue'
import Browse from '../app/pages/browse/index.vue'
import Channel from '../app/pages/browse/channel/[id].vue'
import Playlist from '../app/pages/browse/playlist/[id].vue'
import Watch from '../app/pages/watch.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/admin', component: Admin, meta: { role: 'superadmin' } },
    { path: '/parent/dashboard', component: ParentDashboard, meta: { role: 'parent' } },
    { path: '/parent/child/:id/manage', component: ManageChild, meta: { role: 'parent' } },
    { path: '/browse', component: Browse, meta: { role: 'child' } },
    { path: '/browse/channel/:id', component: Channel, meta: { role: 'child' } },
    { path: '/browse/playlist/:id', component: Playlist, meta: { role: 'child' } },
    { path: '/watch', component: Watch, meta: { role: 'child', fullscreen: true } },
  ],
})

router.beforeEach(async to => {
  const user = await fetchCurrentUser()
  if (to.path === '/') return user.role === 'superadmin' ? '/admin' : user.role === 'parent' ? '/parent/dashboard' : '/browse'
  if (to.meta.role && to.meta.role !== user.role) return '/'
})
