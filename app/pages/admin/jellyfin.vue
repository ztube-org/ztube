<script setup lang="ts">
import { useActionToast } from '../../composables/use-action-toast'
import { computed, onMounted, ref } from 'vue'
import { apiFetch } from '../../../src/api'
import ActionConfirm, { type Confirmation } from '../../components/ActionConfirm.vue'
import MediaArtwork from '../../components/MediaArtwork.vue'
import { formatDuration } from '../../../src/video-ui'

type Server = { id: string; name: string; url: string; enabled: boolean; revision: number; userId?: string | null }
type Item = { id: string; name: string; type: string; seriesName?: string; duration: number; playable: boolean; playbackMode?: 'direct' | 'remux'; imageUrl: string }
type Import = { revision: number; thumbnail?: string; id: string; title: string; serverId: string; itemId: string; lastSyncedAt: number; episodeCount: number }
type Approval = { playlistId: string; childId: number; cartoonPool: number }
type Child = { id: number; displayName: string | null; email: string }
type Scope = { name: string; type: 'libraries' | 'series' | 'seasons' | 'episodes'; parentId?: string }
const notify = useActionToast()
const servers = ref<Server[]>([])
const imports = ref<Import[]>([])
const approvals = ref<Approval[]>([])
const children = ref<Child[]>([])
const busy = ref(false)
const error = ref('')
const notice = ref('')
const draft = ref<(Omit<Server, 'revision'> & { revision?: number; apiKey: string }) | null>(null)
const playbackUsers = ref<{ id: string; name: string }[]>([])
const playbackUserOptions = computed(() => [
  { label: 'Automatic (prefer a non-admin user)', value: 'automatic' },
  ...playbackUsers.value.map(user => ({ label: user.name, value: user.id })),
])
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
function syncImport(connectionId: string, itemId: string) {
  return apiFetch<{ imported: number; skipped: number; title: string }>(`/api/admin/jellyfin/servers/${connectionId}/import`, {
    method: 'POST', body: { itemId },
  })
}
async function importItem(connectionId: string, itemId: string) {
  const result = await syncImport(connectionId, itemId)
  await reload()
  section.value = 'imports'
  notice.value = `${result.title}: ${result.imported} episodes imported${result.skipped ? `; ${result.skipped} unsupported episodes skipped` : ''}. Choose children below to add it to their Cartoon Pool.`
  notify(notice.value, { announcedInline: true })
}
async function syncAllSeries() {
  const series = [...imports.value]
  const failed: string[] = []
  for (const [index, item] of series.entries()) {
    notice.value = `Syncing ${index + 1} of ${series.length} · ${item.title}`
    try { await syncImport(item.serverId, item.itemId) } catch { failed.push(item.title) }
  }
  notice.value = `Series sync complete. ${series.length - failed.length} succeeded, ${failed.length} failed.`
  notify(notice.value, { announcedInline: true, color: failed.length ? 'warning' : 'success' })
  if (failed.length) notice.value += ` Failed: ${failed.join(', ')}.`
  await reload()
}
const confirmation = ref<Confirmation | null>(null)
function requestDeleteImport(item: Import) {
  confirmation.value = {
    title: 'Delete imported series?',
    description: `Remove “${item.title}” from ZTube for all Children. Videos in Jellyfin are kept.`,
    label: 'Delete series', destructive: true, run: () => act(() => deleteImport(item)),
  }
}
async function deleteImport(item: Import) {
  await apiFetch(`/api/admin/jellyfin/imports/${item.id}`, { method: 'DELETE', body: { revision: item.revision } })
  await reload()
  notice.value = `${item.title} deleted from ZTube. Videos in Jellyfin were kept.`
}
function shared(id: string, childId: number) { return approvals.value.some(item => item.playlistId === id && item.childId === childId && item.cartoonPool) }
async function share(item: Import, child: Child, approved: boolean) {
  await apiFetch(`/api/admin/jellyfin/imports/${item.id}/children/${child.id}`, { method: 'PUT', body: { approved } })
  await reload(); notice.value = `${item.title} ${approved ? 'added to' : 'removed from'} ${child.displayName || child.email}’s Cartoon Pool.`
}
function syncTime(epoch: number) { return new Date(epoch * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) }
</script>

<template>
  <div class="zt-page space-y-4 jellyfin-admin">
    <ActionConfirm v-model="confirmation" />
    <header class="flex flex-wrap items-center justify-between gap-3"><div><h1 class="text-2xl font-bold">Jellyfin library</h1><p class="text-sm text-[var(--zt-muted)]">{{ imports.length }} imported series &amp; seasons</p></div><div class="flex flex-wrap gap-2">
      <UButton variant="soft" class="min-h-11" :disabled="busy || !imports.length" @click="act(syncAllSeries)">Sync all series</UButton>
      <UButton class="min-h-11" :disabled="busy" @click="section = 'browse'">Import series</UButton>
    </div></header>
    <div class="zt-admin-tabs" role="tablist" aria-label="Jellyfin management">
      <button v-for="tab in [{ id: 'imports', label: 'Imported series' }, { id: 'browse', label: 'Browse & import' }, { id: 'connections', label: 'Connections' }]" :key="tab.id" role="tab" :aria-selected="section === tab.id" @click="section = tab.id">{{ tab.label }}</button>
    </div>
    <p v-if="error" role="alert" class="rounded-lg border border-error/40 bg-[var(--zt-error-soft)] p-3 text-sm text-[var(--zt-error)]">{{ error }}</p>
    <p v-if="notice" role="status" class="rounded-lg border border-[var(--zt-border)] p-3 text-sm">{{ notice }}</p>
    <div v-show="section === 'connections'" class="space-y-4">
    <div class="flex justify-end"><UButton class="min-h-11" :disabled="busy" @click="edit()">Add Jellyfin server</UButton></div>
    <form v-if="draft" class="zt-panel space-y-3 p-4" aria-label="Jellyfin connection" @submit.prevent="act(save)">
      <h2 class="font-semibold">{{ draft.id === 'new' ? 'New connection' : 'Edit connection' }}</h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField label="Name" required>
          <UInput v-model="draft.name" required maxlength="100" :disabled="busy" :ui="{ base: 'min-h-11' }" class="w-full" />
        </UFormField>
        <UFormField label="Server URL" required>
          <UInput v-model="draft.url" type="url" required :disabled="busy || draft.id !== 'new'" placeholder="https://jellyfin.example.com/" :ui="{ base: 'min-h-11' }" class="w-full" />
        </UFormField>
        <UFormField label="Jellyfin API key" :required="draft.id === 'new'">
          <UInput v-model="draft.apiKey" type="password" autocomplete="new-password" :required="draft.id === 'new'" :disabled="busy"
            :placeholder="draft.id === 'new' ? 'From Jellyfin Dashboard → API Keys' : 'Leave blank to keep the saved key'" :ui="{ base: 'min-h-11' }" class="w-full" />
        </UFormField>
        <UFormField v-if="draft.id !== 'new'" label="Playback user">
          <USelect :model-value="draft.userId ?? 'automatic'" :items="playbackUserOptions" :disabled="busy" class="min-h-11 w-full"
            @update:model-value="draft && (draft.userId = $event === 'automatic' ? null : $event)" />
        </UFormField>
      </div>
      <p class="text-sm text-[var(--zt-muted)]">Use an HTTPS address reachable by ZTube and the children’s devices. Include Jellyfin’s base path if it has one. You can save the connection before testing it.</p>
      <p class="text-sm text-[var(--zt-muted)]">Videos play directly from Jellyfin. Copied links can play outside ZTube’s time limits. If Jellyfin requires authentication, the saved API key is included in the playback link.</p>
      <UCheckbox v-model="draft.enabled" label="Connection enabled" :disabled="busy" class="zt-check-row w-fit"
        :ui="{ root: 'items-center', wrapper: 'min-w-0 flex-1', label: 'flex min-h-11 items-center' }" />
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
      <div class="flex flex-wrap items-center gap-3"><span class="text-sm font-medium">Browse a server</span><UButton v-for="server in servers" :key="server.id" variant="soft" class="min-h-11" :disabled="busy || !server.enabled" @click="act(() => openServer(server))">{{ server.name }}</UButton><UButton v-if="!servers.length" class="min-h-11" @click="edit()">Add Jellyfin server</UButton></div>
    <section v-if="browsing" class="zt-panel space-y-3 p-4" aria-label="Browse Jellyfin">
      <h2 class="text-lg font-semibold">{{ currentServer?.name }}</h2>
      <nav aria-label="Jellyfin folders" class="flex flex-wrap gap-1"><UButton v-for="(entry, index) in scopes" :key="index" :variant="index === scopes.length - 1 ? 'solid' : 'soft'" :disabled="busy" class="min-h-11" @click="act(() => back(index))">{{ entry.name }}</UButton></nav>
      <form v-if="scope.type !== 'libraries'" class="flex gap-2" @submit.prevent="act(() => browse())"><UInput :ui="{ base: 'min-h-11' }" v-model="query" placeholder="Search this list" aria-label="Search Jellyfin" class="min-w-0 flex-1" /><UButton type="submit" :disabled="busy" class="min-h-11">Search</UButton></form>
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
      <div class="flex flex-wrap items-center justify-between gap-3"><p class="text-sm text-[var(--zt-muted)]">Series update only when you select Sync. Automatic sync is off.</p><UInput :ui="{ base: 'min-h-11' }" v-model="importSearch" aria-label="Search imported series" placeholder="Find a series" /></div>
      <p v-if="!imports.length" class="text-sm text-[var(--zt-muted)]">Use Import series to add your first series, then select who can watch.</p>
      <article v-for="item in filteredImports" :key="item.id" class="zt-panel space-y-3 p-3 sm:p-4" :aria-label="item.title">
        <div class="flex flex-wrap items-center gap-3">
          <MediaArtwork :src="item.thumbnail" :title="item.title" kind="playlist" compact class="aspect-video w-24 shrink-0 rounded-lg sm:w-28" />
          <div class="min-w-0 flex-1">
            <h3 class="break-words font-semibold">{{ item.title }}</h3>
            <p class="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-[var(--zt-muted)]">
              <span class="zt-meta-pill tabular-nums" data-tone="accent">{{ item.episodeCount }} episodes</span>
              <span>Updated {{ syncTime(item.lastSyncedAt) }}</span>
            </p>
          </div>
          <div class="flex flex-wrap gap-1">
            <UButton variant="soft" :disabled="busy || !servers.find(s => s.id === item.serverId)?.enabled" class="min-h-11" @click="act(() => importItem(item.serverId, item.itemId))">Sync</UButton>
            <UButton color="error" variant="ghost" class="min-h-11" :disabled="busy" :aria-label="`Delete ${item.title}`" @click="requestDeleteImport(item)">Delete</UButton>
          </div>
        </div>
        <fieldset :disabled="busy">
          <legend class="text-sm font-semibold">Available to</legend>
          <div class="mt-1 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <UCheckbox v-for="child in children" :key="child.id" :label="child.displayName || child.email" :model-value="shared(item.id, child.id)"
              :disabled="busy" class="zt-check-row" :ui="{ root: 'items-center', wrapper: 'min-w-0 flex-1', label: 'flex min-h-11 items-center break-words' }"
              @update:model-value="act(() => share(item, child, $event === true))" />
          </div>
        </fieldset>

        <div class="flex flex-wrap gap-2"><UButton v-for="child in children.filter(child => shared(item.id, child.id))" :key="child.id" :to="`/admin/child/${child.id}/manage`" variant="link" class="min-h-11 px-0">{{ child.displayName || child.email }}’s time &amp; credit settings</UButton></div>
      </article>
    </section>
  </div>
</template>
