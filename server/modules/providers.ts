import { database } from '../database/client.ts'
import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { drizzle } from 'drizzle-orm/d1'
import { and, eq } from 'drizzle-orm'
import * as v from 'valibot'
import * as schema from '../database/schema.ts'
import { requireRole, type AppEnv } from './identity.ts'
import { getProvider, httpsUrl, normalizePath, scopedPath, validateHeaders, seal, unseal, type Credentials } from './provider-config.ts'
import { endpoint, normalizeEndpoint, listDirectory, resolveMediaUrl } from './webdav-client.ts'

const str = (max: number) => v.pipe(v.string(), v.maxLength(max))
const title = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200))
const revision = v.pipe(v.number(), v.integer(), v.minValue(1))
const providerInput = v.object({
  name: title, url: str(500), rootPath: str(1500), enabled: v.boolean(), username: str(200),
  password: v.optional(str(2000)), revision: v.optional(revision),
  headers: v.pipe(v.array(v.object({ name: v.pipe(str(100), v.minLength(1)), value: v.optional(str(4000)) })), v.maxLength(12)),
})
const itemInput = v.object({ providerId: str(64), path: str(1500), title, duration: v.pipe(v.number(), v.integer(), v.minValue(181), v.maxValue(86400)), season: str(100) })
const playlistInput = v.object({ title, thumbnail: str(1000), revision: v.optional(revision), items: v.pipe(v.array(itemInput), v.minLength(1), v.maxLength(200)) })
function parse<T extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(schema: T, input: unknown): v.InferOutput<T> {
  // Never echo validation inputs containing connection secrets.
  const result = v.safeParse(schema, input)
  if (!result.success) throw new HTTPException(400, { message: 'Invalid input. Check required fields, file durations and list sizes.' })
  return result.output
}
export function registerProviderRoutes(app: Hono<AppEnv>) {
  app.use('/api/admin/providers/*', async (c, next) => { requireRole(c.get('user'), 'admin'); c.header('Cache-Control', 'no-store'); await next() })
  app.use('/api/admin/library-playlists/*', async (c, next) => { requireRole(c.get('user'), 'admin'); c.header('Cache-Control', 'no-store'); await next() })
  app.get('/api/admin/providers', async c => {
    requireRole(c.get('user'), 'admin')
    const providers = await database(c.env.DB).query.mediaProviders.findMany()
    const presented = await Promise.all(providers.map(async row => {
      const credentials = await unseal<Credentials>(c.env, row.id, row.credentials)
      return { id: row.id, name: row.name, url: endpoint(row), rootPath: row.rootPath, enabled: row.enabled, revision: row.revision,
        username: credentials.username, hasPassword: Boolean(credentials.password),
        headers: Object.keys(credentials.headers).map(name => ({ name, hasValue: true })) }
    }))
    c.header('Cache-Control', 'no-store')
    return c.json({ providers: presented })
  })
  app.post('/api/admin/providers/:id', async c => {
    const input = parse(providerInput, await c.req.json())
    const id = c.req.param('id') === 'new' ? crypto.randomUUID() : c.req.param('id')
    const previous = c.req.param('id') === 'new' ? undefined : await getProvider(c.env, id)
    const url = normalizeEndpoint(input.url)
    if (input.username.includes(':') || [...input.username].some(char => char.charCodeAt(0) < 32)) throw new HTTPException(400, { message: 'Invalid WebDAV username' })
    const old = previous ? await unseal<Credentials>(c.env, id, previous.credentials) : undefined
    // Published media IDs bind to a server/account identity. Repointing it could
    // silently substitute different content at already-approved paths.
    if (previous && (endpoint(previous) !== url || old?.username !== input.username)) {
      const used = await c.env.DB.prepare('SELECT 1 FROM provider_media m JOIN playlist_videos v ON v.video_id = m.video_id WHERE m.provider_id = ? LIMIT 1').bind(id).first()
      if (used) throw new HTTPException(409, { message: 'This Provider is used by Playlists. Add a new Provider to change its server or username.' })
    }
    // An origin change requires re-entering all secrets, preventing accidental forwarding.
    if (previous && endpoint(previous) !== url && (input.password === undefined || input.headers.some(h => h.value === undefined))) throw new HTTPException(400, { message: 'Re-enter all credentials when changing the Provider URL' })
    const headers = Object.fromEntries(input.headers.map(h => [h.name, h.value ?? Object.entries(old?.headers ?? {}).find(([name]) => name.toLowerCase() === h.name.toLowerCase())?.[1] ?? '']))
    if (new Set(input.headers.map(h => h.name.toLowerCase())).size !== input.headers.length) throw new HTTPException(400, { message: 'Duplicate header names' })
    validateHeaders(headers)
    const credentials: Credentials = { username: input.username, password: input.password ?? old?.password ?? '', headers }
    if (!credentials.username || !credentials.password) throw new HTTPException(400, { message: 'Username and password are required' })
    const values = { name: input.name, url: new URL(url).origin, webdavUrl: url, rootPath: normalizePath(input.rootPath), enabled: input.enabled, credentials: await seal(c.env, id, credentials), sessionToken: null }
    const db = drizzle(c.env.DB)
    if (previous) {
      const updated = await db.update(schema.mediaProviders).set({ ...values, revision: previous.revision + 1 }).where(and(eq(schema.mediaProviders.id, id), eq(schema.mediaProviders.revision, input.revision ?? 0))).returning({ id: schema.mediaProviders.id })
      if (!updated.length) throw new HTTPException(409, { message: 'Provider changed. Reload before saving.' })
    } else await db.insert(schema.mediaProviders).values({ id, ...values })
    return c.json({ id })
  })
  app.post('/api/admin/providers/:id/browse', async c => {
    const provider = await getProvider(c.env, c.req.param('id'))
    const input = parse(v.object({ path: str(1500), page: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000)) }), await c.req.json())
    const path = scopedPath(provider, input.path)
    return c.json(await listDirectory(c.env, provider, path, input.page))
  })
  app.post('/api/admin/providers/:id/preview', async c => {
    const provider = await getProvider(c.env, c.req.param('id'))
    const { path } = parse(v.object({ path: str(1500) }), await c.req.json())
    return c.json({ url: await resolveMediaUrl(c.env, provider, path) })
  })
  app.get('/api/admin/library-playlists', async c => {
    requireRole(c.get('user'), 'admin')
    const playlists = await database(c.env.DB).query.curatedPlaylists.findMany({ columns: { id: true, title: true, thumbnail: true, revision: true } })
    const imports = await database(c.env.DB).query.jellyfinImports.findMany()
    return c.json({ playlists: playlists.filter(playlist => !imports.some(item => item.playlistId === playlist.id)) })
  })
  app.get('/api/admin/library-playlists/:id', async c => {
    const db = database(c.env.DB)
    const playlist = await db.query.curatedPlaylists.findFirst({ where: eq(schema.curatedPlaylists.id, c.req.param('id')), columns: { id: true, title: true, thumbnail: true, revision: true } })
    if (!playlist) throw new HTTPException(404, { message: 'Playlist not found' })
    if (await db.query.jellyfinImports.findFirst({ where: eq(schema.jellyfinImports.playlistId, playlist.id) })) throw new HTTPException(409, { message: 'Manage this imported Playlist in the Jellyfin library.' })
    const items = await db.select({ providerId: schema.providerMedia.providerId, path: schema.providerMedia.path, title: schema.playlistVideos.videoTitle, duration: schema.playlistVideos.duration, season: schema.playlistVideos.season })
      .from(schema.playlistVideos).innerJoin(schema.providerMedia, eq(schema.playlistVideos.videoId, schema.providerMedia.videoId)).where(eq(schema.playlistVideos.playlistId, playlist.id)).orderBy(schema.playlistVideos.position)
    const approvals = await db.query.allowedPlaylists.findMany({ where: eq(schema.allowedPlaylists.playlistId, playlist.id), columns: { childId: true, contentRule: true, tags: true } })
    return c.json({ playlist, items, approvals })
  })
  app.delete('/api/admin/library-playlists/:id', async c => {
    const { revision: expectedRevision } = parse(v.object({ revision }), await c.req.json())
    const id = c.req.param('id')
    if (!id.startsWith('pl:') || id.startsWith('pl:jf:')) throw new HTTPException(400, { message: 'Only WebDAV Playlists can be deleted here.' })
    // Guard every statement in the atomic batch so a stale editor cannot delete a changed list.
    const guard = 'EXISTS (SELECT 1 FROM curated_playlists WHERE id = ? AND revision = ?) AND NOT EXISTS (SELECT 1 FROM jellyfin_imports WHERE playlist_id = ?)'
    const binding = c.env.DB
    const results = await binding.batch([
      binding.prepare(`DELETE FROM allowed_playlists WHERE playlist_id = ? AND ${guard}`).bind(id, id, expectedRevision, id),
      binding.prepare(`DELETE FROM time_pool_bindings WHERE kind = 'playlist' AND content_id = ? AND ${guard}`).bind(id, id, expectedRevision, id),
      binding.prepare(`DELETE FROM playlist_videos WHERE playlist_id = ? AND ${guard}`).bind(id, id, expectedRevision, id),
      binding.prepare(`DELETE FROM curated_playlists WHERE id = ? AND ${guard}`).bind(id, id, expectedRevision, id),
    ])
    if (!results[3].meta.changes) throw new HTTPException(409, { message: 'Playlist changed or was deleted. Reload before trying again.' })
    // Provider media identities, viewing records, and remote files remain intact.
    return c.json({ success: true })
  })
  app.post('/api/admin/library-playlists/:id', async c => {
    const input = parse(playlistInput, await c.req.json())
    if (input.thumbnail) httpsUrl(input.thumbnail)
    const db = database(c.env.DB)
    const id = c.req.param('id') === 'new' ? `pl:${crypto.randomUUID()}` : c.req.param('id')
    if (!id.startsWith('pl:')) throw new HTTPException(400, { message: 'Invalid curated Playlist' })
    if (await db.query.jellyfinImports.findFirst({ where: eq(schema.jellyfinImports.playlistId, id) })) throw new HTTPException(409, { message: 'Sync this imported Playlist from Jellyfin.' })
    const providers = new Map((await db.query.mediaProviders.findMany()).map(p => [p.id, p]))
    const seen = new Set<string>()
    const items = []
    for (const item of input.items) {
      const provider = providers.get(item.providerId)
      if (!provider) throw new HTTPException(400, { message: 'An item references a missing Provider' })
      const path = scopedPath(provider, item.path)
      if (!/\.mp4$/i.test(path)) throw new HTTPException(400, { message: 'Only MP4 files are supported initially' })
      const identity = JSON.stringify([provider.id, path])
      if (seen.has(identity)) throw new HTTPException(400, { message: 'The same video appears twice in this Playlist' })
      seen.add(identity)
      // Stable ID across concurrent imports and multiple Playlists, without exposing paths.
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity)))
      const videoId = 'ol:' + Array.from(digest.slice(0, 24), byte => byte.toString(16).padStart(2, '0')).join('')
      items.push({ ...item, path, videoId })
    }
    const token = crypto.randomUUID()
    const binding = c.env.DB
    const statements = [c.req.param('id') === 'new'
      ? binding.prepare('INSERT INTO curated_playlists (id, title, thumbnail, write_token) VALUES (?, ?, ?, ?)').bind(id, input.title, input.thumbnail || null, token)
      : binding.prepare('UPDATE curated_playlists SET title = ?, thumbnail = ?, revision = revision + 1, write_token = ? WHERE id = ? AND revision = ?').bind(input.title, input.thumbnail || null, token, id, input.revision ?? 0)]
    const guard = 'EXISTS (SELECT 1 FROM curated_playlists WHERE id = ? AND write_token = ?)'
    statements.push(binding.prepare(`DELETE FROM playlist_videos WHERE playlist_id = ? AND ${guard}`).bind(id, id, token))
    for (const [position, item] of items.entries()) {
      statements.push(binding.prepare(`INSERT INTO provider_media (video_id, provider_id, path) SELECT ?, ?, ? WHERE ${guard} ON CONFLICT DO NOTHING`).bind(item.videoId, item.providerId, item.path, id, token))
      statements.push(binding.prepare(`INSERT INTO playlist_videos (playlist_id, video_id, position, video_title, video_thumbnail, duration, channel_title, season) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`).bind(id, item.videoId, position, item.title, input.thumbnail || null, item.duration, input.title, item.season || null, id, token))
    }
    statements.push(binding.prepare(`UPDATE allowed_playlists SET playlist_title = ?, playlist_thumbnail = ?, is_available = 1, next_page_token = NULL WHERE playlist_id = ? AND ${guard}`).bind(input.title, input.thumbnail || null, id, id, token))
    const results = await binding.batch(statements)
    if (!results[0].meta.changes) throw new HTTPException(409, { message: 'Playlist changed. Reload before saving.' })
    return c.json({ id })
  })
  app.put('/api/admin/library-playlists/:id/children/:childId', async c => {
    const input = parse(v.object({ approved: v.boolean(), contentRule: v.picklist(['restricted', 'exempt']), tags: v.pipe(v.array(v.pipe(str(24), v.minLength(1))), v.maxLength(8)) }), await c.req.json())
    const childId = Number(c.req.param('childId'))
    const db = database(c.env.DB)
    const [playlist, child] = await Promise.all([
      db.query.curatedPlaylists.findFirst({ where: eq(schema.curatedPlaylists.id, c.req.param('id')) }),
      db.query.children.findFirst({ where: eq(schema.children.id, childId) }),
    ])
    if (!playlist || !child) throw new HTTPException(404, { message: 'Playlist or Child not found' })
    if (!input.approved) await db.delete(schema.allowedPlaylists).where(and(eq(schema.allowedPlaylists.playlistId, playlist.id), eq(schema.allowedPlaylists.childId, childId)))
    else await c.env.DB.prepare(`
      INSERT INTO allowed_playlists (child_id, playlist_id, playlist_title, playlist_thumbnail, content_rule, tags, is_available)
      SELECT ?, id, title, thumbnail, ?, ?, 1 FROM curated_playlists WHERE id = ?
      ON CONFLICT(child_id, playlist_id) DO UPDATE SET content_rule = excluded.content_rule, tags = excluded.tags,
        playlist_title = excluded.playlist_title, playlist_thumbnail = excluded.playlist_thumbnail, is_available = 1
    `).bind(childId, input.contentRule, JSON.stringify(input.tags), playlist.id).run()
    return c.json({ success: true })
  })
}
