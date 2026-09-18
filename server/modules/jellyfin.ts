import { database } from '../database/client.ts'
import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { drizzle } from 'drizzle-orm/d1'
import { and, eq } from 'drizzle-orm'
import * as v from 'valibot'
import * as schema from '../database/schema.ts'
import { requireRole, type AppEnv } from './identity.ts'
import { httpsUrl, seal } from './provider-config.ts'
import { approvedVideoMetadata } from './catalog.ts'
import { playableJellyfinSource, getJellyfinServer, jellyfinId, jellyfinImage, jellyfinItem, jellyfinItems, jellyfinJson, presentJellyfinItem, type JellyfinItem, type JellyfinServer } from './jellyfin-client.ts'

const text = (max: number) => v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(max))
function parse<T extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>>(schema: T, input: unknown): v.InferOutput<T> {
  const result = v.safeParse(schema, input)
  if (!result.success) throw new HTTPException(400, { message: 'Invalid Jellyfin settings. Check the required fields.' })
  return result.output
}
function itemId(value: string) {
  if (!jellyfinId(value)) throw new HTTPException(400, { message: 'Invalid Jellyfin item ID' })
  return value
}
async function stableId(prefix: string, serverId: string, id: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([serverId, id]))))
  return prefix + Array.from(digest.slice(0, 24), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function importJellyfin(env: Env, server: JellyfinServer, sourceId: string, instant: Date, syncOnly = false) {
  const root = await jellyfinItem(env, server, sourceId)
  if (root.Type !== 'Series' && root.Type !== 'Season') throw new HTTPException(400, { message: 'Choose a Jellyfin series or season to import.' })
  const id = await stableId('pl:jf:', server.id, sourceId)
  const db = database(env.DB)
  const existing = await db.query.curatedPlaylists.findFirst({ where: eq(schema.curatedPlaylists.id, id) })
  if (syncOnly && !existing) throw new HTTPException(409, { message: 'This import was deleted.' })
  const episodes: JellyfinItem[] = []
  for (let offset = 0; ; offset += 100) {
    const page = await jellyfinItems(env, server, { parentId: sourceId, recursive: 'true', includeItemTypes: 'Episode', sortBy: 'ParentIndexNumber,IndexNumber,SortName', sortOrder: 'Ascending', startIndex: String(offset), limit: '100', isMissing: 'false' })
    episodes.push(...page.items)
    if (offset + page.items.length >= page.total) break
    if (page.items.length === 0 || episodes.length >= 5000) throw new HTTPException(422, { message: 'This series is too large to import at once. Import individual seasons.' })
  }
  const seen = new Set<string>()
  const accepted = episodes.filter(episode => {
    if (seen.has(episode.Id)) return false
    seen.add(episode.Id)
    const duration = Math.floor((episode.RunTimeTicks ?? 0) / 10_000_000)
    return episode.Type === 'Episode' && duration > 180 && duration <= 86400 && playableJellyfinSource(episode.MediaSources)
  }).sort((a, b) => (a.ParentIndexNumber ?? 0) - (b.ParentIndexNumber ?? 0) || (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0) || a.Name.localeCompare(b.Name))
  if (!accepted.length && !existing) throw new HTTPException(422, { message: 'No supported episodes found. Use MP4 or MKV files longer than 3 minutes, with H.264 or HEVC video and AAC, MP3, AC3 or EAC3 audio.' })
  const title = root.Type === 'Season' ? `${root.SeriesName ?? accepted[0]?.SeriesName ?? 'Series'} · ${root.Name}` : root.Name
  // Keep both the image identity and import scope deterministic. Season posters
  // use their own item ID, so Child access never depends on unrelated imports.
  const poster = `/api/jellyfin/${server.id}/images/${root.Id}`
  const token = crypto.randomUUID()
  const guard = 'EXISTS (SELECT 1 FROM curated_playlists WHERE id = ? AND write_token = ?)'
  const serverGuard = 'EXISTS (SELECT 1 FROM jellyfin_servers WHERE id = ? AND revision = ? AND enabled = 1)'
  const statements = [existing
    ? env.DB.prepare(`UPDATE curated_playlists SET title = ?, thumbnail = ?, revision = revision + 1, write_token = ? WHERE id = ? AND revision = ? AND ${serverGuard}`).bind(title, poster, token, id, existing.revision, server.id, server.revision)
    : env.DB.prepare(`INSERT INTO curated_playlists (id, title, thumbnail, write_token) SELECT ?, ?, ?, ? WHERE ${serverGuard} ON CONFLICT DO NOTHING`).bind(id, title, poster, token, server.id, server.revision)]
  statements.push(env.DB.prepare(`DELETE FROM playlist_videos WHERE playlist_id = ? AND ${guard}`).bind(id, id, token))
  const mediaRows: (string | number | null)[][] = []
  const episodeRows: (string | number | null)[][] = []
  for (const [position, episode] of accepted.entries()) {
    const videoId = await stableId('jf:', server.id, episode.Id)
    const source = playableJellyfinSource(episode.MediaSources)!
    const episodeTitle = `${episode.ParentIndexNumber === undefined ? '' : `S${episode.ParentIndexNumber} `}${episode.IndexNumber === undefined ? '' : `E${episode.IndexNumber} · `}${episode.Name}`
    mediaRows.push([videoId, server.id, episode.Id, source.Id!])
    episodeRows.push([id, videoId, position, episodeTitle, episode.Overview ?? null, `/api/jellyfin/${server.id}/images/${episode.Id}`, Math.floor(episode.RunTimeTicks! / 10_000_000), episode.SeriesName ?? title, `Season ${episode.ParentIndexNumber ?? 0}`])
  }
  // Pack rows under D1's per-statement bind limit and keep large series within
  // the query budget while publishing the snapshot in a single transaction.
  for (let offset = 0; offset < mediaRows.length; offset += 20) {
    const rows = mediaRows.slice(offset, offset + 20)
    statements.push(env.DB.prepare(`INSERT INTO jellyfin_media (video_id, server_id, item_id, media_source_id) SELECT * FROM (VALUES ${rows.map(() => '(?,?,?,?)').join(',')}) WHERE ${guard} ON CONFLICT(video_id) DO UPDATE SET media_source_id = excluded.media_source_id`).bind(...rows.flat(), id, token))
  }
  for (let offset = 0; offset < episodeRows.length; offset += 10) {
    const rows = episodeRows.slice(offset, offset + 10)
    statements.push(env.DB.prepare(`INSERT INTO playlist_videos (playlist_id, video_id, position, video_title, video_description, video_thumbnail, duration, channel_title, season) SELECT * FROM (VALUES ${rows.map(() => '(?,?,?,?,?,?,?,?,?)').join(',')}) WHERE ${guard}`).bind(...rows.flat(), id, token))
  }
  statements.push(env.DB.prepare(`INSERT INTO jellyfin_imports (playlist_id, server_id, item_id, last_synced_at) SELECT ?, ?, ?, ? WHERE ${guard} ON CONFLICT(playlist_id) DO UPDATE SET last_synced_at = excluded.last_synced_at`).bind(id, server.id, sourceId, Math.floor(instant.getTime() / 1000), id, token))
  statements.push(env.DB.prepare(`UPDATE allowed_playlists SET playlist_title = ?, playlist_thumbnail = ?, is_available = ?, last_fetched_at = ?, next_page_token = NULL WHERE playlist_id = ? AND ${guard}`).bind(title, poster, accepted.length ? 1 : 0, Math.floor(instant.getTime() / 1000), id, id, token))
  const result = await env.DB.batch(statements)
  if (!result[0].meta.changes) throw new HTTPException(409, { message: 'This library or connection changed during import. Reload and retry.' })
  return { id, title, imported: accepted.length, skipped: episodes.length - accepted.length }
}

export async function syncJellyfinLibraries(env: Env, instant = new Date()) {
  const rows = await env.DB.prepare('SELECT i.server_id AS serverId, i.item_id AS itemId FROM jellyfin_imports i JOIN jellyfin_servers s ON s.id = i.server_id WHERE s.enabled = 1 AND i.last_synced_at <= ?').bind(Math.floor(instant.getTime() / 1000) - 6 * 3600).all<{ serverId: string; itemId: string }>()
  for (const row of rows.results) {
    try { await importJellyfin(env, await getJellyfinServer(env, row.serverId), row.itemId, instant, true) }
    catch { console.error(JSON.stringify({ event: 'jellyfin_sync_failed', serverId: row.serverId, itemId: row.itemId })) }
  }
}

export function registerJellyfinRoutes(app: Hono<AppEnv>, now: () => Date) {
  app.use('/api/admin/jellyfin/*', async (c, next) => { requireRole(c.get('user'), 'admin'); c.header('Cache-Control', 'no-store'); await next() })
  app.get('/api/admin/jellyfin/servers', async c => {
    requireRole(c.get('user'), 'admin')
    const servers = await database(c.env.DB).query.jellyfinServers.findMany({ columns: { id: true, name: true, url: true, enabled: true, revision: true, userId: true } })
    return c.json({ servers })
  })
  app.post('/api/admin/jellyfin/servers/:id', async c => {
    const input = parse(v.object({ name: text(100), url: text(500), apiKey: v.optional(text(2000)), enabled: v.boolean(), userId: v.optional(v.nullable(text(36))), revision: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))) }), await c.req.json())
    const url = httpsUrl(input.url)
    if (url.search || url.hash) throw new HTTPException(400, { message: 'Use the Jellyfin server base URL without a query or fragment.' })
    url.pathname = url.pathname.replace(/\/+$/, '') + '/'
    const id = c.req.param('id') === 'new' ? crypto.randomUUID() : c.req.param('id')
    const previous = c.req.param('id') === 'new' ? null : await getJellyfinServer(c.env, id, true)
    if (previous && previous.url !== url.href) throw new HTTPException(409, { message: 'Add a new Jellyfin connection to change its server address.' })
    if (!previous && !input.apiKey) throw new HTTPException(400, { message: 'A Jellyfin API key is required.' })
    if (input.apiKey && /[\r\n]/.test(input.apiKey)) throw new HTTPException(400, { message: 'Invalid Jellyfin API key.' })
    if (input.userId && !jellyfinId(input.userId)) throw new HTTPException(400, { message: 'Invalid Jellyfin user ID.' })
    const values = { userId: input.userId === undefined ? previous?.userId ?? null : input.userId, name: input.name, url: url.href, enabled: input.enabled, credentials: input.apiKey ? await seal(c.env, id, { apiKey: input.apiKey }) : previous!.credentials }
    const db = drizzle(c.env.DB)
    if (previous) {
      const updated = await db.update(schema.jellyfinServers).set({ ...values, revision: previous.revision + 1 }).where(and(eq(schema.jellyfinServers.id, id), eq(schema.jellyfinServers.revision, input.revision ?? 0))).returning({ id: schema.jellyfinServers.id })
      if (!updated.length) throw new HTTPException(409, { message: 'Connection changed. Reload before saving.' })
    } else await db.insert(schema.jellyfinServers).values({ id, ...values })
    return c.json({ id })
  })
  app.get('/api/admin/jellyfin/servers/:id/users', async c => {
    const server = await getJellyfinServer(c.env, c.req.param('id'), true)
    const users = await jellyfinJson<{ Id: string; Name: string; Policy?: { IsDisabled?: boolean } }[]>(c.env, server, 'Users')
    return c.json({ users: users.filter(user => jellyfinId(user.Id) && !user.Policy?.IsDisabled).map(user => ({ id: user.Id, name: user.Name })) })
  })
  app.get('/api/admin/jellyfin/servers/:id/items', async c => {
    const server = await getJellyfinServer(c.env, c.req.param('id'))
    const parentId = c.req.query('parentId')
    const type = parse(v.picklist(['libraries', 'series', 'seasons', 'episodes']), c.req.query('type') ?? 'libraries')
    const page = parse(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000)), Number(c.req.query('page') ?? 0))
    if (type === 'libraries') {
      const result = await jellyfinJson<{ Items?: JellyfinItem[] }>(c.env, server, 'Library/MediaFolders')
      const items = (result.Items ?? []).filter(item => jellyfinId(item.Id ?? '') && typeof item.Name === 'string')
      return c.json({ items: items.map(item => presentJellyfinItem(server.id, item)), nextPage: null })
    }
    if (!parentId) throw new HTTPException(400, { message: 'Choose a library, series or season first.' })
    const types = { series: 'Series', seasons: 'Season', episodes: 'Episode' }
    const result = await jellyfinItems(c.env, server, { parentId: itemId(parentId), includeItemTypes: types[type], recursive: type === 'series' ? 'true' : 'false', startIndex: String(page * 48), limit: '48', sortBy: type === 'series' ? 'SortName' : 'ParentIndexNumber,IndexNumber,SortName', sortOrder: 'Ascending', ...(c.req.query('q') ? { searchTerm: c.req.query('q')!.slice(0, 200) } : {}) })
    return c.json({ items: result.items.map(item => presentJellyfinItem(server.id, item)), nextPage: page * 48 + result.items.length < result.total ? page + 1 : null })
  })
  app.post('/api/admin/jellyfin/servers/:id/import', async c => {
    const input = parse(v.object({ itemId: text(36) }), await c.req.json())
    return c.json(await importJellyfin(c.env, await getJellyfinServer(c.env, c.req.param('id')), itemId(input.itemId), now()))
  })
  app.get('/api/admin/jellyfin/imports', async c => {
    const rows = await c.env.DB.prepare('SELECT p.id, p.title, p.thumbnail, p.revision, i.server_id AS serverId, i.item_id AS itemId, i.last_synced_at AS lastSyncedAt, (SELECT count(*) FROM playlist_videos v WHERE v.playlist_id = p.id) AS episodeCount FROM jellyfin_imports i JOIN curated_playlists p ON p.id = i.playlist_id ORDER BY p.title').all()
    const approvals = await c.env.DB.prepare('SELECT a.playlist_id AS playlistId, a.child_id AS childId, a.cartoon_pool AS cartoonPool FROM allowed_playlists a JOIN jellyfin_imports i ON i.playlist_id = a.playlist_id').all()
    return c.json({ imports: rows.results, approvals: approvals.results })
  })
  app.delete('/api/admin/jellyfin/imports/:id', async c => {
    const input = parse(v.object({ revision: v.pipe(v.number(), v.integer(), v.minValue(1)) }), await c.req.json())
    const id = c.req.param('id')
    const guard = 'EXISTS (SELECT 1 FROM curated_playlists p JOIN jellyfin_imports i ON i.playlist_id = p.id WHERE p.id = ? AND p.revision = ?)'
    const db = c.env.DB
    const results = await db.batch([
      db.prepare(`DELETE FROM allowed_playlists WHERE playlist_id = ? AND ${guard}`).bind(id, id, input.revision),
      db.prepare(`DELETE FROM time_pool_bindings WHERE kind = 'playlist' AND content_id = ? AND ${guard}`).bind(id, id, input.revision),
      db.prepare(`DELETE FROM playlist_videos WHERE playlist_id = ? AND ${guard}`).bind(id, id, input.revision),
      // The foreign key also removes the import, so future automatic syncs skip it.
      db.prepare(`DELETE FROM curated_playlists WHERE id = ? AND ${guard}`).bind(id, id, input.revision),
    ])
    if (!results[3].meta.changes) throw new HTTPException(409, { message: 'This series changed or was deleted. Reload before deleting.' })
    return c.json({ success: true })
  })
  app.put('/api/admin/jellyfin/imports/:id/children/:childId', async c => {
    const input = parse(v.object({ approved: v.boolean() }), await c.req.json())
    const childId = parse(v.pipe(v.number(), v.integer(), v.minValue(1)), Number(c.req.param('childId')))
    const id = c.req.param('id')
    const exists = await c.env.DB.prepare('SELECT 1 FROM jellyfin_imports WHERE playlist_id = ? AND EXISTS (SELECT 1 FROM children WHERE id = ?)').bind(id, childId).first()
    if (!exists) throw new HTTPException(404, { message: 'Child or imported library not found' })
    if (!input.approved) await c.env.DB.prepare('DELETE FROM allowed_playlists WHERE child_id = ? AND playlist_id = ?').bind(childId, id).run()
    else await c.env.DB.prepare(`INSERT INTO allowed_playlists (child_id, playlist_id, playlist_title, playlist_thumbnail, cartoon_pool, is_available)
      SELECT ?, id, title, thumbnail, 1, 1 FROM curated_playlists WHERE id = ?
      ON CONFLICT(child_id, playlist_id) DO UPDATE SET cartoon_pool = 1, is_available = 1, playlist_title = excluded.playlist_title, playlist_thumbnail = excluded.playlist_thumbnail`).bind(childId, id).run()
    return c.json({ success: true })
  })
  app.get('/api/jellyfin/:serverId/images/:itemId', async c => {
    const server = await getJellyfinServer(c.env, c.req.param('serverId'))
    const id = itemId(c.req.param('itemId'))
    const user = c.get('user')
    if (user.role !== 'admin') {
      const db = database(c.env.DB)
      const media = await db.query.jellyfinMedia.findFirst({ where: and(eq(schema.jellyfinMedia.serverId, server.id), eq(schema.jellyfinMedia.itemId, id)) })
      const approved = media && await approvedVideoMetadata(db, user.id, media.videoId)
      const poster = await c.env.DB.prepare('SELECT 1 FROM jellyfin_imports i JOIN allowed_playlists a ON a.playlist_id = i.playlist_id WHERE i.server_id = ? AND i.item_id = ? AND a.child_id = ? AND a.is_available = 1').bind(server.id, id, user.id).first()
      if (!approved && !poster) throw new HTTPException(403, { message: 'Image is not Approved Content' })
    }
    return jellyfinImage(c.env, server, id)
  })
}
