<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { apiFetch } from '../../../src/api'
import { readVideoDuration } from '../../../src/video-metadata'
import { formatDuration } from '../../../src/video-ui'

type Provider = { id: string; name: string; url: string; rootPath: string; enabled: boolean; username: string; revision?: number; hasPassword?: boolean; headers: { name: string; hasValue?: boolean; value?: string }[] }
type Item = { providerId: string; path: string; title: string; duration: number; season: string }
type DraftItem = Item & { reading?: boolean; metadataError?: string }
type Playlist = { id: string; title: string; thumbnail: string | null; revision: number }
type File = { name: string; path: string; isDirectory: boolean; playable: boolean }
type Approval = { childId: number; contentRule: 'restricted' | 'exempt'; tags: string[] }
const providers = ref<Provider[]>([])
const playlists = ref<Playlist[]>([])
const children = ref<{ id: number; email: string; displayName: string | null }[]>([])
const error = ref('')
const notice = ref('')
const busy = ref(false)
async function act(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true; error.value = ''; notice.value = ''
  try { await action() } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Unable to complete this action' }
  finally { busy.value = false }
}
async function reload() {
  const [p, l, c] = await Promise.all([
    apiFetch<{ providers: Provider[] }>('/api/admin/providers'),
    apiFetch<{ playlists: Playlist[] }>('/api/admin/library-playlists'),
    apiFetch<{ children: typeof children.value }>('/api/admin/children'),
  ])
  providers.value = p.providers; playlists.value = l.playlists; children.value = c.children
}
onMounted(() => { void act(reload) })
const provider = ref<(Provider & { password: string }) | null>(null)
function editProvider(value?: Provider) {
  provider.value = { ...(value ?? { id: 'new', name: '', url: 'https://', rootPath: '/', username: '', enabled: true, headers: [] }), headers: value?.headers.map(h => ({ ...h, value: '' })) ?? [], password: '' }
}
async function saveProvider() {
  if (!provider.value) return
  const p = provider.value
  await apiFetch(`/api/admin/providers/${p.id}`, { method: 'POST', body: { ...p, password: p.password || undefined,
    headers: p.headers.map(h => ({ name: h.name, value: h.value || (h.hasValue ? undefined : '') })) } })
  provider.value = null; await reload(); notice.value = 'Provider saved. Browse its files to test the connection.'
}
const providerId = ref('')
const path = ref('/')
const files = ref<File[]>([])
const selected = ref<string[]>([])
const nextPage = ref<number | null>(null)
const season = ref('')
const previewUrl = ref('')
const currentProvider = computed(() => providers.value.find(p => p.id === providerId.value))
async function browse(directory: string, page = 1) {
  previewUrl.value = ''
  const result = await apiFetch<{ files: File[]; path: string; nextPage: number | null }>(`/api/admin/providers/${providerId.value}/browse`, { method: 'POST', body: { path: directory, page } })
  if (page === 1) { files.value = []; selected.value = [] }
  files.value = [...files.value, ...result.files].sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  path.value = result.path; nextPage.value = result.nextPage
  season.value = directory.split('/').filter(Boolean).at(-1) ?? ''
}
async function changeProvider() {
  files.value = []; selected.value = []
  await browse(currentProvider.value?.rootPath ?? '/')
}
async function preview(file: { path: string; providerId?: string }) {
  previewUrl.value = ''
  const result = await apiFetch<{ url: string }>(`/api/admin/providers/${file.providerId ?? providerId.value}/preview`, { method: 'POST', body: { path: file.path } })
  previewUrl.value = result.url
}
const playlistId = ref('new')
const playlistTitle = ref('')
const thumbnail = ref('')
const playlistRevision = ref<number>()
const items = ref<DraftItem[]>([])
const probes = new Set<AbortController>()
let disposed = false
onBeforeUnmount(() => { disposed = true; for (const probe of probes) probe.abort() })
async function readDetails(item: DraftItem) {
  if (disposed || !items.value.includes(item)) return
  item.reading = true; item.metadataError = undefined
  const controller = new AbortController()
  probes.add(controller)
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const { url } = await apiFetch<{ url: string }>(`/api/admin/providers/${item.providerId}/preview`, {
      method: 'POST', body: { path: item.path }, signal: controller.signal,
    })
    item.duration = await readVideoDuration(url, controller.signal)
    if (item.duration <= 180) item.metadataError = 'This video is 3 minutes or shorter. Remove it to save.'
    else if (item.duration > 86400) item.metadataError = 'This video is longer than 24 hours. Remove it to save.'
  } catch (cause) {
    item.duration = 0
    item.metadataError = controller.signal.aborted ? 'Reading video details timed out. Retry to try again.'
      : cause instanceof Error ? cause.message : 'Unable to read video details. Retry to try again.'
  } finally {
    clearTimeout(timeout); probes.delete(controller); item.reading = false
  }
}
const saveProblem = computed(() => {
  const reading = items.value.filter(i => i.reading).length
  if (reading) return `Reading video details for ${reading} episode${reading === 1 ? '' : 's'}…`
  if (items.value.some(i => i.metadataError || !Number.isInteger(i.duration) || i.duration <= 180 || i.duration > 86400)) return 'Some episodes need attention. Retry reading their details or remove them before saving.'
  if (!playlistTitle.value.trim()) return 'Enter a Playlist title to save.'
  if (!items.value.length) return 'Add at least one episode to save.'
  if (items.value.some(i => !i.title.trim())) return 'Enter a title for every episode to save.'
  return ''
})
const approvals = ref<Approval[]>([])
const childRules = ref<Record<number, 'restricted' | 'exempt'>>({})
const childTags = ref<Record<number, string>>({})
function newPlaylist() {
  playlistId.value = 'new'; playlistTitle.value = ''; thumbnail.value = ''; playlistRevision.value = undefined
  items.value = []; approvals.value = []; childRules.value = {}; childTags.value = {}
}
async function deletePlaylist() {
  if (!confirm(`Delete “${playlistTitle.value}” for everyone? This removes the ZTube playlist and all sharing. Files on WebDAV are kept.`)) return
  await apiFetch(`/api/admin/library-playlists/${playlistId.value}`, { method: 'DELETE', body: { revision: playlistRevision.value } })
  newPlaylist()
  await reload()
  notice.value = 'Playlist deleted. Files on WebDAV were kept.'
}
async function loadPlaylist(id: string) {
  const result = await apiFetch<{ playlist: Playlist; items: Item[]; approvals: Approval[] }>(`/api/admin/library-playlists/${id}`)
  playlistId.value = id; playlistTitle.value = result.playlist.title; thumbnail.value = result.playlist.thumbnail ?? ''
  playlistRevision.value = result.playlist.revision; items.value = result.items.map(i => ({ ...i, season: i.season ?? '' })); approvals.value = result.approvals
  childRules.value = Object.fromEntries(result.approvals.map(a => [a.childId, a.contentRule])); childTags.value = Object.fromEntries(result.approvals.map(a => [a.childId, a.tags.join(', ')]))
}
async function addSelected() {
  const added = files.value.filter(f => selected.value.includes(f.path) && f.playable && !items.value.some(i => i.providerId === providerId.value && i.path === f.path))
  if (items.value.length + added.length > 200) throw new Error('A Playlist can contain up to 200 episodes. Select fewer files or create another Playlist.')
  const start = items.value.length
  for (const file of added) {
    items.value.push({ providerId: providerId.value, path: file.path, title: file.name.replace(/\.mp4$/i, ''), season: season.value,
      duration: 0, reading: true })
  }
  selected.value = []
  // Bound simultaneous media loads; a large season must not open 200 downloads.
  const queue = items.value.slice(start)
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length && !disposed) await readDetails(queue.shift()!)
  }))
  notice.value = 'Files added to the draft. Check episode titles and order, then save.'
}
function move(index: number, step: number) {
  const target = index + step
  if (target < 0 || target >= items.value.length) return
  const item = items.value.splice(index, 1)[0]!
  items.value.splice(target, 0, item)
}
async function savePlaylist() {
  if (saveProblem.value) throw new Error(saveProblem.value)
  const result = await apiFetch<{ id: string }>(`/api/admin/library-playlists/${playlistId.value}`, { method: 'POST', body: {
    title: playlistTitle.value, thumbnail: thumbnail.value, revision: playlistRevision.value,
    items: items.value.map(({ providerId, path, title, duration, season }) => ({ providerId, path, title, duration, season })),
  } })
  await loadPlaylist(result.id); await reload(); notice.value = 'Playlist saved. Use Share below to choose who can watch.'
}
async function share(childId: number, approved: boolean) {
  await apiFetch(`/api/admin/library-playlists/${playlistId.value}/children/${childId}`, { method: 'PUT', body: {
    approved, contentRule: childRules.value[childId] ?? 'restricted', tags: (childTags.value[childId] ?? '').split(',').map(t => t.trim()).filter(Boolean),
  } })
  const result = await apiFetch<{ approvals: Approval[] }>(`/api/admin/library-playlists/${playlistId.value}`)
  approvals.value = result.approvals; notice.value = approved ? 'Playlist shared with this Child.' : 'Playlist approval removed.'
}
const affectedChildren = computed(() => approvals.value.map(a => children.value.find(c => c.id === a.childId)).filter(Boolean).map(c => c!.displayName || c!.email).join(', '))
</script>

<template>
  <div class="zt-page space-y-4 library-admin">
    <UButton to="/admin/jellyfin" variant="soft" class="min-h-11">Manage Jellyfin library</UButton>
    <div class="flex flex-wrap items-center justify-between gap-2"><div><NuxtLink to="/admin" class="inline-flex min-h-11 items-center text-sm">← Admin</NuxtLink><h1 class="text-2xl font-bold">Providers & Playlists</h1></div><UButton :disabled="busy" @click="editProvider()">Add WebDAV Provider</UButton></div>
    <p v-if="error" role="alert" class="rounded-lg bg-red-50 p-3 text-red-700">{{ error }}</p>
    <p v-if="notice" role="status" class="rounded-lg bg-blue-50 p-3 text-blue-800">{{ notice }}</p>
    <section v-if="provider" class="zt-panel space-y-3 rounded-xl border p-3" aria-label="Provider settings">
      <h2 class="font-semibold">{{ provider.id === 'new' ? 'Add' : 'Edit' }} WebDAV Provider</h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <label>Name<input v-model="provider.name" autocomplete="off" /></label>
        <label>WebDAV URL<input v-model="provider.url" placeholder="https://olist.example.com/dav/" /></label>
        <label>Root directory<input v-model="provider.rootPath" placeholder="/" /></label>
        <label>Username<input v-model="provider.username" autocomplete="off" /></label>
        <label>Password<input v-model="provider.password" type="password" autocomplete="new-password" :placeholder="provider.hasPassword ? 'Leave blank to keep saved password' : 'WebDAV password'" /></label>
      </div>
      <p class="text-sm text-[var(--zt-muted)]">Enter the complete WebDAV endpoint, e.g. https://olist.example.com/dav/. Enable WebDAV read permission for this account. Playback requires a direct download URL; in OpenList choose WebDAV 302 redirect mode.</p>
      <label class="flex items-center gap-2"><input v-model="provider.enabled" type="checkbox" />Enabled</label>
      <p class="text-sm text-[var(--zt-muted)]">Optional Cloudflare Access headers: use CF-Access-Client-Id and CF-Access-Client-Secret, or the custom header configured in Access. Authorization is reserved for WebDAV Basic Auth. Your Access policy must allow the service token.</p>
      <div v-for="(header, index) in provider.headers" :key="index" class="flex flex-wrap items-end gap-2">
        <label class="flex-1">Header name<input v-model="header.name" placeholder="X-ZTube-Access" /></label>
        <label class="flex-1">Secret value<input v-model="header.value" type="password" autocomplete="new-password" :placeholder="header.hasValue ? 'Blank keeps saved value' : 'Header value'" /></label>
        <UButton variant="soft" @click="provider.headers.splice(index, 1)">Remove</UButton>
      </div>
      <div class="flex flex-wrap gap-2"><UButton variant="soft" @click="provider.headers.push({ name: '', value: '' })">Add header</UButton><UButton :loading="busy" @click="act(saveProvider)">Save Provider</UButton><UButton variant="ghost" @click="provider = null">Cancel</UButton></div>
    </section>
    <div class="flex flex-wrap gap-2"><UButton v-for="p in providers" :key="p.id" variant="soft" :disabled="busy" @click="editProvider(p)">{{ p.name }}{{ p.enabled ? '' : ' (disabled)' }} · Edit</UButton></div>
    <section class="zt-panel space-y-3 rounded-xl border p-3" aria-label="Playlist editor">
      <div class="flex flex-wrap gap-2"><h2 class="mr-auto font-semibold">Playlists</h2><UButton v-if="playlistId !== 'new'" color="error" variant="soft" :disabled="busy" @click="act(deletePlaylist)">Delete Playlist</UButton><UButton variant="soft" :disabled="busy" @click="newPlaylist">New Playlist</UButton></div>
      <div class="flex flex-wrap gap-2"><UButton v-for="p in playlists" :key="p.id" :variant="playlistId === p.id ? 'solid' : 'soft'" :disabled="busy" @click="act(() => loadPlaylist(p.id))">{{ p.title }}</UButton></div>
      <div class="grid gap-3 sm:grid-cols-2"><label>Playlist title<input v-model="playlistTitle" /></label><label>Artwork URL (optional)<input v-model="thumbnail" placeholder="https://…" /></label></div>
      <details open class="rounded-lg border p-3">
        <summary class="flex min-h-11 cursor-pointer items-center font-medium">Select files from a Provider</summary>
        <div class="flex flex-wrap items-end gap-2">
          <label>Provider<select aria-label="Provider" v-model="providerId" :disabled="busy" @change="act(changeProvider)"><option value="" disabled>Choose a Provider</option><option v-for="p in providers" :key="p.id" :value="p.id" :disabled="!p.enabled">{{ p.name }}</option></select></label>
          <label class="min-w-48 flex-1">Directory<input v-model="path" /></label><UButton :disabled="busy || !providerId" @click="act(() => browse(path))">Browse / test</UButton>
          <UButton variant="soft" :disabled="busy || !providerId || path === currentProvider?.rootPath" @click="act(() => browse(path.slice(0, path.lastIndexOf('/')) || '/'))">Up</UButton>
        </div>
        <div class="my-2 max-h-72 overflow-auto divide-y rounded-lg border">
          <div v-for="file in files" :key="file.path" class="flex min-h-11 items-center gap-2 px-2">
            <UButton v-if="file.isDirectory" variant="ghost" class="min-w-0 flex-1 justify-start" :disabled="busy" @click="act(() => browse(file.path))">📁 {{ file.name }}</UButton>
            <template v-else><label class="flex min-w-0 flex-1 items-center gap-2"><input v-if="file.playable" v-model="selected" type="checkbox" :value="file.path" /><span class="truncate" :class="{ 'opacity-50': !file.playable }">{{ file.name }}</span></label><UButton v-if="file.playable" variant="ghost" :disabled="busy" @click="act(() => preview(file))">Preview</UButton></template>
          </div>
        </div>
        <UButton v-if="nextPage" variant="soft" :disabled="busy" @click="act(() => browse(path, nextPage!))">Load more files</UButton>
        <div class="mt-2 flex flex-wrap items-end gap-2"><UButton variant="soft" :disabled="busy" @click="selected = files.filter(f => f.playable).map(f => f.path)">Select listed videos</UButton><label>Season label<input v-model="season" placeholder="Season 1" /></label><UButton :disabled="busy || !selected.length" @click="act(addSelected)">Add {{ selected.length }} files</UButton></div>
        <p class="mt-2 text-sm text-[var(--zt-muted)]">Video details are read automatically when you add files. Videos must be longer than 3 minutes. New files on the server are never added automatically.</p>
      </details>
      <div v-if="previewUrl" class="space-y-2"><video :src="previewUrl" controls playsinline preload="metadata" class="max-h-72 w-full rounded-lg bg-black" @error="error = 'Preview failed. Check direct URL access and browser codec support.'" /><UButton variant="ghost" @click="previewUrl = ''">Close preview</UButton></div>
      <p class="text-sm">{{ items.length }} / 200 episodes · Use the arrows to change episode order</p>
      <div class="space-y-2">
        <div v-for="(item, index) in items" :key="`${item.providerId}:${item.path}`" class="flex flex-wrap items-end gap-2 rounded-lg border p-2">
          <span class="self-center font-medium">{{ index + 1 }}</span><label class="min-w-40 flex-1">Episode title<input v-model="item.title" /></label><label class="w-28">Season<input v-model="item.season" /></label><span class="self-center text-sm tabular-nums">{{ item.reading ? 'Reading details…' : formatDuration(item.duration) }}</span>
          <UButton variant="ghost" :aria-label="`Move episode ${index + 1} up`" :disabled="index === 0" @click="move(index, -1)">↑</UButton><UButton variant="ghost" :aria-label="`Move episode ${index + 1} down`" :disabled="index === items.length - 1" @click="move(index, 1)">↓</UButton><UButton variant="ghost" :disabled="busy" @click="act(() => preview(item))">Preview</UButton><UButton variant="ghost" @click="items.splice(index, 1)">Remove</UButton>
          <div v-if="item.metadataError" class="flex w-full items-center gap-2 text-sm text-red-700"><span role="alert" class="flex-1">{{ item.metadataError }}</span><UButton v-if="!item.duration" variant="soft" :disabled="busy" :aria-label="`Retry reading ${item.title}`" @click="act(() => readDetails(item))">Retry</UButton></div>
        </div>
      </div>
      <p v-if="affectedChildren" class="text-sm text-amber-700">Saving updates the shared Playlist for: {{ affectedChildren }}.</p>
      <p v-if="saveProblem" id="playlist-save-problem" role="status" class="text-sm text-[var(--zt-muted)]">{{ saveProblem }}</p>
      <UButton :disabled="busy || Boolean(saveProblem)" :aria-describedby="saveProblem ? 'playlist-save-problem' : undefined" @click="act(savePlaylist)">Save Playlist</UButton>
    </section>
    <section v-if="playlistId !== 'new'" class="zt-panel space-y-3 rounded-xl border p-3" aria-label="Share Playlist">
      <h2 class="font-semibold">Share saved Playlist</h2><p class="text-sm text-[var(--zt-muted)]">Each Child has an independent Content Rule and tags. Adding a Provider never grants access.</p>
      <div v-for="child in children" :key="child.id" class="flex flex-wrap items-end gap-2 border-t pt-2">
        <span class="min-w-40 flex-1 self-center">{{ child.displayName || child.email }} <span v-if="approvals.some(a => a.childId === child.id)" class="text-sm text-green-700">· Shared</span></span>
        <label>Content Rule<select :value="childRules[child.id] ?? 'restricted'" @change="childRules[child.id] = ($event.target as HTMLSelectElement).value as 'restricted' | 'exempt'"><option value="restricted">Restricted</option><option value="exempt">Allowance-exempt</option></select></label><label>Tags, comma separated<input v-model="childTags[child.id]" /></label>
        <UButton :disabled="busy" @click="act(() => share(child.id, true))">{{ approvals.some(a => a.childId === child.id) ? 'Update sharing' : 'Share' }}</UButton><UButton v-if="approvals.some(a => a.childId === child.id)" variant="soft" :disabled="busy" @click="act(() => share(child.id, false))">Remove access</UButton>
      </div>
    </section>
  </div>
</template>

<style scoped>
.library-admin label { font-size: 0.875rem; }
.library-admin input:not([type=checkbox]), .library-admin select { display: block; width: 100%; min-height: 44px; border: 1px solid var(--zt-border); border-radius: 8px; padding: 8px 10px; background: var(--zt-surface); }
.library-admin input[type=checkbox] { width: 22px; height: 22px; margin: 11px; flex-shrink: 0; }
.library-admin button { min-height: 44px; }
</style>
