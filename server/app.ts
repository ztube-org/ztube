import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { and, count, eq, isNull, lt, or } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { z } from 'zod'
import * as schema from './database/schema.ts'
import { isValidTimeZone, viewingDayAt } from './utils/viewing-day.ts'
import { parseYouTubeUrl } from './utils/youtube.ts'
import {
  fetchChannelMetadata,
  fetchChannelVideos,
  fetchPlaylistMetadata,
  fetchPlaylistVideos,
  fetchVideoMetadata,
} from './utils/youtube-api.ts'

type UserRole = 'superadmin' | 'parent' | 'child'
type CurrentUser = { id: number | null; email: string; displayName: string | null; role: UserRole }
type AppEnv = { Bindings: Env; Variables: { user: CurrentUser } }
type ApiContext = Context<AppEnv>
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const allowanceMinutes = z.number().int().min(0).max(1440).refine(value => value % 15 === 0, 'Must be a 15-minute increment')
const timeSettingsInput = z.object({
  timeZone: z.string().trim().min(1).refine(isValidTimeZone, 'Invalid IANA time zone'),
  weekdayAllowanceMinutes: allowanceMinutes,
  weekendAllowanceMinutes: allowanceMinutes,
  safetyCapMinutes: allowanceMinutes,
})

export type AppDependencies = {
  now?: () => Date
  resolveUser?: (request: Request, env: Env) => Promise<CurrentUser>
}

export function createApp(dependencies: AppDependencies = {}) {
  const now = dependencies.now ?? (() => new Date())
  const userResolver = dependencies.resolveUser ?? resolveUser
  const app = new Hono<AppEnv>()

  app.use('/api/*', async (c, next) => {
    c.set('user', await userResolver(c.req.raw, c.env))
    await next()
  })

  app.onError((error, c) => {
    if (error instanceof HTTPException) return c.json({ message: error.message }, error.status)
    if (error instanceof z.ZodError) return c.json({ message: 'Invalid request', issues: error.issues }, 400)
    console.error(JSON.stringify({ event: 'request_error', message: error.message }))
    return c.json({ message: 'Internal server error' }, 500)
  })

  app.get('/api/auth/session', c => c.json({ user: c.get('user') }))

  app.get('/api/admin/parents', async c => {
    requireRole(c.get('user'), 'superadmin')
    const db = drizzle(c.env.DB, { schema })
    const parentList = await db.query.parents.findMany()
    const result = await Promise.all(parentList.map(async parent => {
      const [childCount] = await db.select({ count: count() }).from(schema.children).where(eq(schema.children.parentId, parent.id))
      return { id: parent.id, email: parent.email, displayName: parent.displayName, createdAt: parent.createdAt, childrenCount: childCount.count }
    }))
    return c.json({ parents: result })
  })

  app.get('/api/parent/children', async c => {
    const user = requireRole(c.get('user'), 'parent')
    const db = drizzle(c.env.DB, { schema })
    const list = await db.query.children.findMany({ where: eq(schema.children.parentId, user.id!) })
    const children = await Promise.all(list.map(async child => {
      const [channels, playlists, videos] = await Promise.all([
        db.select({ count: count() }).from(schema.allowedChannels).where(eq(schema.allowedChannels.childId, child.id)),
        db.select({ count: count() }).from(schema.allowedPlaylists).where(eq(schema.allowedPlaylists.childId, child.id)),
        db.select({ count: count() }).from(schema.allowedVideos).where(eq(schema.allowedVideos.childId, child.id)),
      ])
      return { id: child.id, email: child.email, displayName: child.displayName, createdAt: child.createdAt, stats: { channels: channels[0].count, playlists: playlists[0].count, videos: videos[0].count } }
    }))
    return c.json({ children })
  })

  app.post('/api/parent/children', async c => {
    const user = requireRole(c.get('user'), 'parent')
    const input = z.object({
      email: z.string().trim().toLowerCase().email(),
      displayName: z.string().trim().max(100).optional(),
      timeZone: z.string().trim().refine(isValidTimeZone, 'Invalid IANA time zone').optional(),
    }).parse(await c.req.json())
    const db = drizzle(c.env.DB, { schema })
    const [child, parent] = await Promise.all([
      db.query.children.findFirst({ where: eq(schema.children.email, input.email) }),
      db.query.parents.findFirst({ where: eq(schema.parents.email, input.email) }),
    ])
    if (child || parent) throw new HTTPException(400, { message: 'This Google account already has a ZTube profile' })
    const [created] = await db.insert(schema.children).values({ parentId: user.id!, email: input.email, displayName: input.displayName || null }).returning()
    await db.insert(schema.childTimeSettings).values({ childId: created.id, timeZone: input.timeZone ?? 'UTC' })
    return c.json({ id: created.id, email: created.email, displayName: created.displayName }, 201)
  })

  app.get('/api/parent/children/:id/time-settings', async c => {
    const { db, childId } = await ownedChild(c)
    let settings = await db.query.childTimeSettings.findFirst({ where: eq(schema.childTimeSettings.childId, childId) })
    if (!settings) {
      await db.insert(schema.childTimeSettings).values({ childId }).onConflictDoNothing()
      settings = await db.query.childTimeSettings.findFirst({ where: eq(schema.childTimeSettings.childId, childId) })
    }
    if (!settings) throw new HTTPException(500, { message: 'Unable to create time settings' })
    return c.json({ settings, viewingDay: viewingDayAt(new Date(), settings.timeZone, settings) })
  })

  app.put('/api/parent/children/:id/time-settings', async c => {
    const { db, childId } = await ownedChild(c)
    const input = timeSettingsInput.parse(await c.req.json())
    await db.insert(schema.childTimeSettings).values({ childId, ...input, updatedAt: new Date() }).onConflictDoUpdate({
      target: schema.childTimeSettings.childId,
      set: { ...input, updatedAt: new Date() },
    })
    const settings = await db.query.childTimeSettings.findFirst({ where: eq(schema.childTimeSettings.childId, childId) })
    return c.json({ settings, viewingDay: viewingDayAt(new Date(), input.timeZone, input) })
  })

  app.get('/api/parent/children/:id/content', async c => {
    const user = requireRole(c.get('user'), 'parent')
    const childId = numericId(c.req.param('id'))
    const db = drizzle(c.env.DB, { schema })
    const child = await db.query.children.findFirst({ where: and(eq(schema.children.id, childId), eq(schema.children.parentId, user.id!)) })
    if (!child) throw new HTTPException(404, { message: 'Child not found' })
    const [channels, playlists, videos] = await Promise.all([
      db.query.allowedChannels.findMany({ where: eq(schema.allowedChannels.childId, childId) }),
      db.query.allowedPlaylists.findMany({ where: eq(schema.allowedPlaylists.childId, childId) }),
      db.query.allowedVideos.findMany({ where: eq(schema.allowedVideos.childId, childId) }),
    ])
    return c.json({ child: { id: child.id, email: child.email, displayName: child.displayName }, channels, playlists, videos })
  })

  app.post('/api/parent/content/add', async c => {
    const user = requireRole(c.get('user'), 'parent')
    const input = z.object({ childId: z.number().int().positive(), url: z.string().url() }).parse(await c.req.json())
    const db = drizzle(c.env.DB, { schema })
    const child = await db.query.children.findFirst({ where: and(eq(schema.children.id, input.childId), eq(schema.children.parentId, user.id!)) })
    if (!child) throw new HTTPException(404, { message: 'Child not found' })
    const parsed = parseYouTubeUrl(input.url)
    if (!parsed) throw new HTTPException(400, { message: 'Invalid YouTube URL' })
    if (parsed.type === 'channel' && parsed.id.startsWith('c/')) {
      throw new HTTPException(400, { message: 'Use the channel @handle or /channel/ URL to conserve YouTube API quota' })
    }
    if (parsed.type === 'video') {
      const item = await fetchVideoMetadata(parsed.id, c.env.YOUTUBE_API_KEY)
      const [content] = await db.insert(schema.allowedVideos).values({ childId: input.childId, videoId: item.videoId, videoTitle: item.title, videoThumbnail: item.thumbnail, duration: item.duration, channelTitle: item.channelTitle, lastFetchedAt: new Date(), isAvailable: true }).returning()
      return c.json({ type: 'video', content })
    }
    if (parsed.type === 'playlist') {
      const item = await fetchPlaylistMetadata(parsed.id, c.env.YOUTUBE_API_KEY)
      const [content] = await db.insert(schema.allowedPlaylists).values({ childId: input.childId, playlistId: item.playlistId, playlistTitle: item.title, playlistThumbnail: item.thumbnail, lastFetchedAt: null, isAvailable: true }).returning()
      return c.json({ type: 'playlist', content })
    }
    const item = await fetchChannelMetadata(parsed.id, c.env.YOUTUBE_API_KEY)
    const [content] = await db.insert(schema.allowedChannels).values({ childId: input.childId, channelId: item.channelId, uploadsPlaylistId: item.uploadsPlaylistId, channelTitle: item.title, channelThumbnail: item.thumbnail, lastFetchedAt: null, isAvailable: true }).returning()
    return c.json({ type: 'channel', content })
  })

  app.delete('/api/parent/content/:id', async c => {
    const user = requireRole(c.get('user'), 'parent')
    const id = numericId(c.req.param('id'))
    const type = c.req.query('type')
    const db = drizzle(c.env.DB, { schema })
    const table = type === 'channel' ? schema.allowedChannels : type === 'playlist' ? schema.allowedPlaylists : type === 'video' ? schema.allowedVideos : null
    if (!table) throw new HTTPException(400, { message: 'Invalid content type' })
    const content = await db.select().from(table).where(eq(table.id, id)).get()
    if (!content) throw new HTTPException(404, { message: 'Content not found' })
    const child = await db.query.children.findFirst({ where: and(eq(schema.children.id, content.childId), eq(schema.children.parentId, user.id!)) })
    if (!child) throw new HTTPException(403, { message: 'Forbidden' })
    await db.delete(table).where(eq(table.id, id))
    return c.json({ success: true })
  })

  app.get('/api/child/browse', async c => {
    const user = requireRole(c.get('user'), 'child')
    const db = drizzle(c.env.DB, { schema })
    const [channels, playlists, videos] = await Promise.all([
      db.query.allowedChannels.findMany({ where: eq(schema.allowedChannels.childId, user.id!) }),
      db.query.allowedPlaylists.findMany({ where: eq(schema.allowedPlaylists.childId, user.id!) }),
      db.query.allowedVideos.findMany({ where: eq(schema.allowedVideos.childId, user.id!) }),
    ])
    return c.json({ channels, playlists, videos })
  })

  app.post('/api/child/playback-authorizations', async c => {
    const user = requireRole(c.get('user'), 'child')
    const input = z.object({ videoId: z.string().trim().min(1).max(64) }).parse(await c.req.json())
    const db = drizzle(c.env.DB, { schema })

    const direct = await db.query.allowedVideos.findFirst({
      where: and(
        eq(schema.allowedVideos.childId, user.id!),
        eq(schema.allowedVideos.videoId, input.videoId),
        eq(schema.allowedVideos.isAvailable, true),
      ),
    })
    const channel = direct ? null : await db.select({ id: schema.allowedChannels.id })
      .from(schema.allowedChannels)
      .innerJoin(schema.channelVideos, eq(schema.channelVideos.channelId, schema.allowedChannels.channelId))
      .where(and(
        eq(schema.allowedChannels.childId, user.id!),
        eq(schema.allowedChannels.isAvailable, true),
        eq(schema.channelVideos.videoId, input.videoId),
      ))
      .get()
    const playlist = direct || channel ? null : await db.select({ id: schema.allowedPlaylists.id })
      .from(schema.allowedPlaylists)
      .innerJoin(schema.playlistVideos, eq(schema.playlistVideos.playlistId, schema.allowedPlaylists.playlistId))
      .where(and(
        eq(schema.allowedPlaylists.childId, user.id!),
        eq(schema.allowedPlaylists.isAvailable, true),
        eq(schema.playlistVideos.videoId, input.videoId),
      ))
      .get()

    if (!direct && !channel && !playlist) {
      throw new HTTPException(403, { message: 'Video is not Approved Content' })
    }
    return c.json({
      authorization: {
        videoId: input.videoId,
        source: direct ? 'video' : channel ? 'channel' : 'playlist',
        authorizedAt: now().toISOString(),
      },
    })
  })

  app.get('/api/child/channel/:id/videos', async c => channelOrPlaylist(c, 'channel'))
  app.get('/api/child/playlist/:id/videos', async c => channelOrPlaylist(c, 'playlist'))
  return app
}

async function ownedChild(c: ApiContext) {
  const user = requireRole(c.get('user'), 'parent')
  const childId = numericId(c.req.param('id'))
  const db = drizzle(c.env.DB, { schema })
  const child = await db.query.children.findFirst({ where: and(eq(schema.children.id, childId), eq(schema.children.parentId, user.id!)) })
  if (!child) throw new HTTPException(404, { message: 'Child not found' })
  return { db, childId, child }
}

async function channelOrPlaylist(c: ApiContext, kind: 'channel' | 'playlist') {
  const user = requireRole(c.get('user'), 'child')
  const id = numericId(c.req.param('id'))
  const db = drizzle(c.env.DB, { schema })
  if (kind === 'channel') {
    const item = await db.query.allowedChannels.findFirst({ where: and(eq(schema.allowedChannels.id, id), eq(schema.allowedChannels.childId, user.id!)) })
    if (!item) throw new HTTPException(404, { message: 'channel not found' })
    const videos = await db.query.channelVideos.findMany({ where: eq(schema.channelVideos.channelId, item.channelId), orderBy: (table, { asc }) => [asc(table.position)] })
    if (await claimRefresh(db, 'channel', item.id, item.lastFetchedAt, videos[0]?.fetchedAt)) {
      c.executionCtx.waitUntil(refreshVideos(c.env, kind, id, item.channelId, item.uploadsPlaylistId))
    }
    return c.json({ channel: { id: item.id, channelId: item.channelId, title: item.channelTitle, thumbnail: item.channelThumbnail, isAvailable: item.isAvailable }, videos })
  }
  const item = await db.query.allowedPlaylists.findFirst({ where: and(eq(schema.allowedPlaylists.id, id), eq(schema.allowedPlaylists.childId, user.id!)) })
  if (!item) throw new HTTPException(404, { message: 'playlist not found' })
  const videos = await db.query.playlistVideos.findMany({ where: eq(schema.playlistVideos.playlistId, item.playlistId), orderBy: (table, { asc }) => [asc(table.position)] })
  if (await claimRefresh(db, 'playlist', item.id, item.lastFetchedAt, videos[0]?.fetchedAt)) {
    c.executionCtx.waitUntil(refreshVideos(c.env, kind, id, item.playlistId))
  }
  return c.json({ playlist: { id: item.id, playlistId: item.playlistId, title: item.playlistTitle, thumbnail: item.playlistThumbnail, isAvailable: item.isAvailable }, videos })
}

async function refreshVideos(env: Env, kind: 'channel' | 'playlist', id: number, externalId: string, uploadsPlaylistId?: string) {
  const db = drizzle(env.DB, { schema })
  const allowedTable = kind === 'channel' ? schema.allowedChannels : schema.allowedPlaylists
  const videoTable = kind === 'channel' ? schema.channelVideos : schema.playlistVideos
  const videoIdColumn = kind === 'channel' ? schema.channelVideos.channelId : schema.playlistVideos.playlistId
  try {
    const fresh = kind === 'channel'
      ? uploadsPlaylistId
        ? await fetchPlaylistVideos(uploadsPlaylistId, env.YOUTUBE_API_KEY)
        : await fetchChannelVideos(externalId, env.YOUTUBE_API_KEY)
      : await fetchPlaylistVideos(externalId, env.YOUTUBE_API_KEY)
    await db.delete(videoTable).where(eq(videoIdColumn, externalId))
    if (fresh.length) await db.insert(videoTable).values(fresh.map((video, position) => ({ [kind === 'channel' ? 'channelId' : 'playlistId']: externalId, videoId: video.videoId, position, videoTitle: video.title, videoThumbnail: video.thumbnail, duration: video.duration, channelTitle: video.channelTitle })))
    const allowedExternalId = kind === 'channel' ? schema.allowedChannels.channelId : schema.allowedPlaylists.playlistId
    await db.update(allowedTable).set({ lastFetchedAt: new Date(), isAvailable: true }).where(eq(allowedExternalId, externalId))
  } catch (error) {
    console.error(JSON.stringify({ event: 'youtube_refresh_failed', kind, id, message: error instanceof Error ? error.message : 'unknown' }))
    await db.update(allowedTable).set({ lastFetchedAt: null, isAvailable: false }).where(eq(allowedTable.id, id))
  }
}

async function claimRefresh(
  db: ReturnType<typeof drizzle<typeof schema>>,
  kind: 'channel' | 'playlist',
  id: number,
  lastFetchedAt: Date | null,
  cacheFetchedAt: Date | null | undefined,
) {
  const cutoff = new Date(Date.now() - CACHE_TTL_MS)
  if (cacheFetchedAt && cacheFetchedAt > cutoff) {
    if (!lastFetchedAt || lastFetchedAt < cacheFetchedAt) {
      const table = kind === 'channel' ? schema.allowedChannels : schema.allowedPlaylists
      await db.update(table).set({ lastFetchedAt: cacheFetchedAt, isAvailable: true }).where(eq(table.id, id))
    }
    return false
  }
  if (lastFetchedAt && lastFetchedAt >= cutoff) return false
  const table = kind === 'channel' ? schema.allowedChannels : schema.allowedPlaylists
  const claimed = await db.update(table)
    .set({ lastFetchedAt: new Date() })
    .where(and(eq(table.id, id), or(isNull(table.lastFetchedAt), lt(table.lastFetchedAt, cutoff))))
    .returning({ id: table.id })
  return claimed.length > 0
}

async function resolveUser(request: Request, env: Env): Promise<CurrentUser> {
  const email = identityEmail(request, env)
  const admins = new Set(env.ADMIN_EMAILS.split(',').map(value => value.trim().toLowerCase()).filter(Boolean))
  if (admins.has(email)) return { id: null, email, displayName: null, role: 'superadmin' }
  const db = drizzle(env.DB, { schema })
  const child = await db.query.children.findFirst({ where: eq(schema.children.email, email) })
  if (child) return { id: child.id, email, displayName: child.displayName, role: 'child' }
  let parent = await db.query.parents.findFirst({ where: eq(schema.parents.email, email) })
  if (!parent) {
    await db.insert(schema.parents).values({ email }).onConflictDoNothing()
    parent = await db.query.parents.findFirst({ where: eq(schema.parents.email, email) })
  }
  if (!parent) throw new HTTPException(500, { message: 'Unable to create user profile' })
  return { id: parent.id, email, displayName: parent.displayName, role: 'parent' }
}

function identityEmail(request: Request, env: Env) {
  const value = String(env.AUTH_MODE) === 'local' ? env.LOCAL_DEV_USER_EMAIL : request.headers.get('Cf-Access-Authenticated-User-Email')
  const email = value?.trim().toLowerCase() || ''
  if (!email.includes('@')) throw new HTTPException(401, { message: 'A valid Cloudflare Access session is required' })
  return email
}

function requireRole(user: CurrentUser, role: UserRole) {
  if (user.role !== role) throw new HTTPException(403, { message: 'Forbidden' })
  return user
}

function numericId(value: string | undefined) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new HTTPException(400, { message: 'Invalid id' })
  return id
}
