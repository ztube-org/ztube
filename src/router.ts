import { createRouter, createWebHistory } from 'vue-router'
import { fetchCurrentUser } from './api'
const Home = () => import('../app/pages/index.vue')
const AdminDashboard = () => import('../app/pages/admin/index.vue')
const ManageChild = () => import('../app/pages/admin/child/[id]/manage.vue')
const Browse = () => import('../app/pages/browse/index.vue')
const Channel = () => import('../app/pages/browse/channel/[id].vue')
const Playlist = () => import('../app/pages/browse/playlist/[id].vue')
const Watch = () => import('../app/pages/watch.vue')

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: Home },
    { path: '/admin', component: AdminDashboard, meta: { role: 'admin' } },
    { path: '/admin/jellyfin', component: () => import('../app/pages/admin/jellyfin.vue'), meta: { role: 'admin' } },
    { path: '/admin/library', component: () => import('../app/pages/admin/library.vue'), meta: { role: 'admin' } },
    { path: '/admin/child/:id/manage', component: ManageChild, meta: { role: 'admin' } },
    { path: '/browse', component: Browse },
    { path: '/cartoon-pool', component: () => import('../app/pages/cartoon-pool.vue') },
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
