<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { apiFetch } from '../../../src/api'
import AdminNav from '../../components/AdminNav.vue'
import MediaArtwork from '../../components/MediaArtwork.vue'
import { formatDuration } from '../../../src/video-ui'

type Server = { id: string; name: string; url: string; enabled: boolean; revision: number; userId?: string | null }
type Item = { id: string; name: string; type: string; seriesName?: string; duration: number; playable: boolean; playbackMode?: 'direct' | 'remux'; imageUrl: string }
type Import = { revision: number; thumbnail?: string; id: string; title: string; serverId: string; itemId: string; lastSyncedAt: number; episodeCount: number }
type Approval = { playlistId: string; childId: number; cartoonPool: number }
type Child = { id: number; displayName: string | null; email: string }
type Scope = { name: string; type: 'libraries' | 'series' | 'seasons' | 'episodes'; parentId?: string }
const servers = ref<Server[]>([])
const imports = ref<Import[]>([])
const approvals = ref<Approval[]>([])
const children = ref<Child[]>([])
const busy = ref(false)
const error = ref('')
const notice = ref('')
const draft = ref<(Omit<Server, 'revision'> & { revision?: number; apiKey: string }) | null>(null)
const playbackUsers = ref<{ id: string; name: string }[]>([])
const serverId = ref('')
const currentServer = computed(() => servers.value.find(server => server.id === serverId.value))
const scopes = ref<Scope[]>([{ name: 'Libraries', type: 'libraries' }])
const scope = computed(() => scopes.value[scopes.value.length - 1]!)
const items = ref<Item[]>([])
const nextPage = ref<number | null>(null)
const query = ref('')
const browsing = ref(false)
const section = ref('imports')
const importSearch = ref('')
const filteredImports = computed(() => imports.value.filter(item => item.title.toLowerCase().includes(importSearch.value.trim().toLowerCase())))

async function act(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await action() } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Unable to complete this action' }
  finally { busy.value = false }
}
async function reload() {
  const [s, i, c] = await Promise.all([
    apiFetch<{ servers: Server[] }>('/api/admin/jellyfin/servers'),
    apiFetch<{ imports: Import[]; approvals: Approval[] }>('/api/admin/jellyfin/imports'),
    apiFetch<{ children: Child[] }>('/api/admin/children'),
  ])
  servers.value = s.servers; imports.value = i.imports; approvals.value = i.approvals; children.value = c.children
}
onMounted(() => { void act(reload) })
async function edit(server?: Server) {
  section.value = 'connections'
  draft.value = { ...(server ?? { id: 'new', name: 'Jellyfin', url: 'https://', enabled: true }), apiKey: '' }
  playbackUsers.value = []
  if (server) {
    try {
      const result = await apiFetch<{ users: { id: string; name: string }[] }>(`/api/admin/jellyfin/servers/${server.id}/users`)
      if (draft.value?.id === server.id) playbackUsers.value = result.users
    } catch { /* Settings can still be edited while the server is offline. */ }
  }
}
async function save() {
  if (!draft.value) return
  await apiFetch(`/api/admin/jellyfin/servers/${draft.value.id}`, { method: 'POST', body: { ...draft.value, apiKey: draft.value.apiKey || undefined, userId: draft.value.userId || null } })
  draft.value = null; await reload(); notice.value = 'Connection saved. Choose Browse library when your server is ready.'
}
async function browse(page = 0) {
  const params = new URLSearchParams({ type: scope.value.type, page: String(page) })
  if (scope.value.parentId) params.set('parentId', scope.value.parentId)
  if (query.value.trim()) params.set('q', query.value.trim())
  const result = await apiFetch<{ items: Item[]; nextPage: number | null }>(`/api/admin/jellyfin/servers/${serverId.value}/items?${params}`)
  items.value = page === 0 ? result.items : [...items.value, ...result.items]
  nextPage.value = result.nextPage
}
async function openServer(server: Server) {
  section.value = 'browse'
  serverId.value = server.id; scopes.value = [{ name: 'Libraries', type: 'libraries' }]; items.value = []; query.value = ''; browsing.value = true
  await browse()
}
async function open(item: Item) {
  const type = scope.value.type === 'libraries' ? 'series' : scope.value.type === 'series' ? 'seasons' : 'episodes'
  scopes.value.push({ name: item.name, type, parentId: item.id }); items.value = []; query.value = ''; nextPage.value = null
  await browse()
}
async function back(index: number) {
  scopes.value = scopes.value.slice(0, index + 1); items.value = []; query.value = ''; nextPage.value = null
  await browse()
}
async function importItem(connectionId: string, itemId: string) {
  const result = await apiFetch<{ imported: number; skipped: number; title: string }>(`/api/admin/jellyfin/servers/${connectionId}/import`, { method: 'POST', body: { itemId } })
  await reload()
  section.value = 'imports'
  notice.value = `${result.title}: ${result.imported} episodes imported${result.skipped ? `; ${result.skipped} unsupported episodes skipped` : ''}. Choose children below to add it to their Cartoon Pool.`
}
async function deleteImport(item: Import) {
  if (!confirm(`Delete “${item.title}” from ZTube for all children? This also stops automatic syncing. Videos in Jellyfin are kept.`)) return
  await apiFetch(`/api/admin/jellyfin/imports/${item.id}`, { method: 'DELETE', body: { revision: item.revision } })
  await reload()
  notice.value = `${item.title} deleted from ZTube. Videos in Jellyfin were kept.`
}
function shared(id: string, childId: number) { return approvals.value.some(item => item.playlistId === id && item.childId === childId && item.cartoonPool) }
async function share(item: Import, child: Child, approved: boolean) {
  await apiFetch(`/api/admin/jellyfin/imports/${item.id}/children/${child.id}`, { method: 'PUT', body: { approved } })
  await reload(); notice.value = `${item.title} ${approved ? 'added to' : 'removed from'} ${child.displayName || child.email}’s Cartoon Pool.`
}
async function toggleShare(item: Import, child: Child, event: Event) {
  const input = event.target as HTMLInputElement
  await act(() => share(item, child, input.checked))
  input.checked = shared(item.id, child.id)
}
function syncTime(epoch: number) { return new Date(epoch * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) }
</script>

<template>
  <div class="zt-page space-y-4 jellyfin-admin">
    <AdminNav />
    <header class="flex flex-wrap items-center justify-between gap-3"><div><h1 class="text-2xl font-bold">Jellyfin library</h1><p class="text-sm text-[var(--zt-muted)]">{{ imports.length }} imported series &amp; seasons</p></div><UButton @click="section = 'browse'">Import series</UButton></header>
    <div class="zt-admin-tabs" role="tablist" aria-label="Jellyfin management">
      <button v-for="tab in [{ id: 'imports', label: 'Imported series' }, { id: 'browse', label: 'Browse & import' }, { id: 'connections', label: 'Connections' }]" :key="tab.id" role="tab" :aria-selected="section === tab.id" @click="section = tab.id">{{ tab.label }}</button>
    </div>
    <p v-if="error" role="alert" class="rounded-lg border border-red-300 p-3 text-sm text-red-600">{{ error }}</p>
    <p v-if="notice" role="status" class="rounded-lg border border-[var(--zt-border)] p-3 text-sm">{{ notice }}</p>
    <div v-show="section === 'connections'" class="space-y-4">
    <div class="flex justify-end"><UButton :disabled="busy" @click="edit()">Add Jellyfin server</UButton></div>
    <form v-if="draft" class="zt-panel space-y-3 p-4" aria-label="Jellyfin connection" @submit.prevent="act(save)">
      <h2 class="font-semibold">{{ draft.id === 'new' ? 'New connection' : 'Edit connection' }}</h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="text-sm">Name<input v-model="draft.name" required maxlength="100" :disabled="busy" class="zt-surface mt-1 min-h-11 w-full rounded-lg border px-3" /></label>
        <label class="text-sm">Server URL<input v-model="draft.url" type="url" required :disabled="busy || draft.id !== 'new'" placeholder="https://jellyfin.example.com/" class="zt-surface mt-1 min-h-11 w-full rounded-lg border px-3" /></label>
        <label class="text-sm sm:col-span-2">Jellyfin API key<input v-model="draft.apiKey" type="password" autocomplete="new-password" :required="draft.id === 'new'" :disabled="busy" :placeholder="draft.id === 'new' ? 'From Jellyfin Dashboard → API Keys' : 'Leave blank to keep the saved key'" class="zt-surface mt-1 min-h-11 w-full rounded-lg border px-3" /></label>
        <label v-if="draft.id !== 'new'" class="text-sm sm:col-span-2">Playback user<select v-model="draft.userId" :disabled="busy" class="zt-surface mt-1 min-h-11 w-full rounded-lg border px-3"><option :value="null">Automatic (prefer a non-admin user)</option><option v-for="user in playbackUsers" :key="user.id" :value="user.id">{{ user.name }}</option></select></label>
      </div>
      <p class="text-sm text-[var(--zt-muted)]">Use an HTTPS address reachable by ZTube and the children’s devices. Include Jellyfin’s base path if it has one. You can save the connection before testing it.</p>
      <p class="text-sm text-[var(--zt-muted)]">Videos play directly from Jellyfin. Copied links can play outside ZTube’s time limits. If Jellyfin requires authentication, the saved API key is included in the playback link.</p>
      <label class="flex min-h-11 items-center gap-2 text-sm"><input v-model="draft.enabled" type="checkbox" :disabled="busy" />Connection enabled</label>
      <div class="flex gap-2"><UButton type="submit" :loading="busy" class="min-h-11">Save connection</UButton><UButton variant="soft" :disabled="busy" class="min-h-11" @click="draft = null">Cancel</UButton></div>
    </form>
    <section aria-label="Jellyfin servers" class="grid gap-3 sm:grid-cols-2">
      <p v-if="!servers.length && !busy" class="text-sm text-[var(--zt-muted)]">Add your Jellyfin server to get started.</p>
      <article v-for="server in servers" :key="server.id" class="zt-panel space-y-2 p-3">
        <h2 class="font-semibold">{{ server.name }}<span v-if="!server.enabled" class="ml-2 text-sm font-normal">Disabled</span></h2>
        <p class="break-all text-sm text-[var(--zt-muted)]">{{ server.url }}</p>
        <div class="flex gap-2"><UButton :disabled="busy || !server.enabled" class="min-h-11" @click="act(() => openServer(server))">Browse library</UButton><UButton variant="soft" :disabled="busy" class="min-h-11" @click="edit(server)">Edit connection</UButton></div>
      </article>
    </section>
    </div>
    <div v-show="section === 'browse'" class="space-y-4">
      <div class="flex flex-wrap items-center gap-3"><span class="text-sm font-medium">Browse a server</span><UButton v-for="server in servers" :key="server.id" variant="soft" :disabled="busy || !server.enabled" @click="act(() => openServer(server))">{{ server.name }}</UButton><UButton v-if="!servers.length" @click="edit()">Add Jellyfin server</UButton></div>
    <section v-if="browsing" class="zt-panel space-y-3 p-4" aria-label="Browse Jellyfin">
      <h2 class="text-lg font-semibold">{{ currentServer?.name }}</h2>
      <nav aria-label="Jellyfin folders" class="flex flex-wrap gap-1"><UButton v-for="(entry, index) in scopes" :key="index" :variant="index === scopes.length - 1 ? 'solid' : 'soft'" :disabled="busy" class="min-h-11" @click="act(() => back(index))">{{ entry.name }}</UButton></nav>
      <form v-if="scope.type !== 'libraries'" class="flex gap-2" @submit.prevent="act(() => browse())"><UInput v-model="query" placeholder="Search this list" aria-label="Search Jellyfin" class="min-h-11 flex-1" /><UButton type="submit" :disabled="busy" class="min-h-11">Search</UButton></form>
      <p v-if="!items.length && !busy" class="text-sm text-[var(--zt-muted)]">No items found. Choose a library containing TV series.</p>
      <div class="divide-y divide-[var(--zt-border)]">
        <div v-for="item in items" :key="item.id" class="flex flex-wrap items-center gap-3 py-2">
          <div class="min-w-0 flex-1"><p class="font-medium">{{ item.name }}</p><p v-if="item.type === 'Episode'" class="text-sm text-[var(--zt-muted)]">{{ formatDuration(item.duration) }} · {{ item.playable && item.duration > 180 ? (item.playbackMode === 'remux' ? 'Remux · compatible browser required' : 'MP4 direct playback') : 'Unsupported format or duration' }}</p></div>
          <UButton v-if="scope.type !== 'episodes'" variant="soft" :disabled="busy" class="min-h-11" @click="act(() => open(item))">{{ scope.type === 'libraries' ? 'View series' : scope.type === 'series' ? 'View seasons' : 'View episodes' }}</UButton>
          <UButton v-if="item.type === 'Series' || item.type === 'Season'" :disabled="busy" class="min-h-11" :aria-label="`Import ${item.name}`" @click="act(() => importItem(serverId, item.id))">{{ item.type === 'Series' ? 'Import series' : 'Import season' }}</UButton>
        </div>
      </div>
      <UButton v-if="nextPage !== null" variant="soft" :disabled="busy" class="min-h-11" @click="act(() => browse(nextPage!))">Load more</UButton>
      <p class="text-sm text-[var(--zt-muted)]">MP4 and MKV: H.264 or device-compatible HEVC, with AAC, MP3, AC3 or EAC3 audio. Jellyfin keeps the original video and converts incompatible audio to AAC when needed. Unsupported files are skipped; subtitles are not converted.</p>
    </section>
    </div>
    <section v-show="section === 'imports'" aria-label="Imported Jellyfin series" class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-3"><p class="text-sm text-[var(--zt-muted)]">Shared series sync automatically about every 6 hours.</p><UInput v-model="importSearch" aria-label="Search imported series" placeholder="Find a series" /></div>
      <p v-if="!imports.length" class="text-sm text-[var(--zt-muted)]">Use Import series to add your first series, then select who can watch.</p>
      <article v-for="item in filteredImports" :key="item.id" class="zt-panel space-y-3 p-4" :aria-label="item.title">
        <div class="flex flex-wrap items-center gap-3"><MediaArtwork :src="item.thumbnail" :title="item.title" kind="playlist" compact class="h-16 w-28 shrink-0 rounded-lg" /><div class="min-w-0 flex-1"><h3 class="font-semibold">{{ item.title }}</h3><p class="text-sm text-[var(--zt-muted)]">{{ item.episodeCount }} episodes · Updated {{ syncTime(item.lastSyncedAt) }}</p></div><UButton variant="soft" :disabled="busy || !servers.find(s => s.id === item.serverId)?.enabled" class="min-h-11" @click="act(() => importItem(item.serverId, item.itemId))">Sync</UButton><UButton color="error" variant="ghost" :disabled="busy" :aria-label="`Delete ${item.title}`" @click="act(() => deleteImport(item))">Delete</UButton></div>
        <fieldset :disabled="busy"><legend class="text-sm font-medium">Available to</legend>
          <div class="grid gap-x-4 sm:grid-cols-2"><label v-for="child in children" :key="child.id" class="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" :checked="shared(item.id, child.id)" @change="toggleShare(item, child, $event)" />{{ child.displayName || child.email }}</label></div>
        </fieldset>

        <div class="flex flex-wrap gap-2"><UButton v-for="child in children.filter(child => shared(item.id, child.id))" :key="child.id" :to="`/admin/child/${child.id}/manage`" variant="link" class="min-h-11 px-0">{{ child.displayName || child.email }}’s time &amp; credit settings</UButton></div>
      </article>
    </section>
  </div>
</template>

<style scoped>
input[type="checkbox"] { width: 1.25rem; height: 1.25rem; min-width: 1.25rem; min-height: 1.25rem; accent-color: var(--zt-blue); }
</style>
