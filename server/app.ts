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
const playbackState = z.enum(['playing', 'paused', 'buffering', 'ended'])
const contentRule = z.enum(['restricted', 'exempt'])
const HEARTBEAT_INTERVAL_SECONDS = 15
const PLAYBACK_LEASE_SECONDS = 60

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

  app.put('/api/parent/children/:id/content/:type/:contentId/rule', async c => {
    const { db, childId } = await ownedChild(c)
    const type = z.enum(['channel', 'playlist', 'video']).parse(c.req.param('type'))
    const contentId = numericId(c.req.param('contentId'))
    const input = z.object({ rule: contentRule }).parse(await c.req.json())
    const table = type === 'channel' ? schema.allowedChannels : type === 'playlist' ? schema.allowedPlaylists : schema.allowedVideos
    const updated = await db.update(table).set({ contentRule: input.rule })
      .where(and(eq(table.id, contentId), eq(table.childId, childId)))
      .returning({ id: table.id, contentRule: table.contentRule })
    if (!updated.length) throw new HTTPException(404, { message: 'Approved Content not found' })
    return c.json({ content: updated[0] })
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
    const [channels, playlists, videos, settings] = await Promise.all([
      db.query.allowedChannels.findMany({ where: eq(schema.allowedChannels.childId, user.id!) }),
      db.query.allowedPlaylists.findMany({ where: eq(schema.allowedPlaylists.childId, user.id!) }),
      db.query.allowedVideos.findMany({ where: eq(schema.allowedVideos.childId, user.id!) }),
      ensureTimeSettings(db, user.id!),
    ])
    const day = viewingDayAt(now(), settings.timeZone, settings)
    const usage = await dailyUsage(db, user.id!, day.localDate)
    return c.json({
      channels, playlists, videos,
      watchTime: watchTimeStatus(day.allowanceMinutes * 60, settings.safetyCapMinutes * 60, usage),
    })
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
    const channel = direct ? null : await db.select({ id: schema.allowedChannels.id, contentRule: schema.allowedChannels.contentRule })
      .from(schema.allowedChannels)
      .innerJoin(schema.channelVideos, eq(schema.channelVideos.channelId, schema.allowedChannels.channelId))
      .where(and(
        eq(schema.allowedChannels.childId, user.id!),
        eq(schema.allowedChannels.isAvailable, true),
        eq(schema.channelVideos.videoId, input.videoId),
      ))
      .get()
    const playlist = direct || channel ? null : await db.select({ id: schema.allowedPlaylists.id, contentRule: schema.allowedPlaylists.contentRule })
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
    const settings = await ensureTimeSettings(db, user.id!)
    const day = viewingDayAt(now(), settings.timeZone, settings)
    const usageBucket = (direct?.contentRule ?? channel?.contentRule ?? playlist?.contentRule) === 'exempt' ? 'exempt' : 'restricted'
    const usage = await dailyUsage(db, user.id!, day.localDate)
    const limitSeconds = (usageBucket === 'exempt' ? settings.safetyCapMinutes : day.allowanceMinutes) * 60
    const usedSeconds = usageBucket === 'exempt' ? usage.exemptSeconds : usage.restrictedSeconds
    const remainingSeconds = Math.max(0, limitSeconds - usedSeconds)
    if (remainingSeconds === 0) throw new HTTPException(403, { message: usageBucket === 'exempt' ? 'Safety Cap exhausted' : 'Daily Allowance exhausted' })
    const sessionId = crypto.randomUUID()
    const authorizedAt = now()
    const leaseExpiresAt = new Date(authorizedAt.getTime() + PLAYBACK_LEASE_SECONDS * 1000)
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE playback_sessions SET ended_at = ?, last_state = 'ended' WHERE child_id = ? AND ended_at IS NULL`).bind(epochSeconds(authorizedAt), user.id!),
      c.env.DB.prepare(`INSERT INTO playback_sessions (id, child_id, viewing_day, last_sequence, last_state, last_acknowledged_at, lease_expires_at, usage_bucket) VALUES (?, ?, ?, 0, 'paused', ?, ?, ?)`).bind(
        sessionId, user.id!, day.localDate, epochSeconds(authorizedAt), epochSeconds(leaseExpiresAt), usageBucket,
      ),
    ])
    return c.json({
      authorization: {
        videoId: input.videoId,
        source: direct ? 'video' : channel ? 'channel' : 'playlist',
        usageBucket,
        authorizedAt: authorizedAt.toISOString(),
        sessionId,
        remainingSeconds,
        heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
      },
    })
  })

  app.get('/api/child/watch-time', async c => {
    const user = requireRole(c.get('user'), 'child')
    const db = drizzle(c.env.DB, { schema })
    const settings = await ensureTimeSettings(db, user.id!)
    const day = viewingDayAt(now(), settings.timeZone, settings)
    const usage = await dailyUsage(db, user.id!, day.localDate)
    return c.json({ viewingDay: day.localDate, ...watchTimeStatus(day.allowanceMinutes * 60, settings.safetyCapMinutes * 60, usage) })
  })

  app.post('/api/child/playback-authorizations/:id/heartbeats', async c => {
    const user = requireRole(c.get('user'), 'child')
    const input = z.object({ sequence: z.number().int().positive(), state: playbackState }).parse(await c.req.json())
    const db = drizzle(c.env.DB, { schema })
    const session = await db.query.playbackSessions.findFirst({ where: and(eq(schema.playbackSessions.id, c.req.param('id')), eq(schema.playbackSessions.childId, user.id!)) })
    if (!session) throw new HTTPException(404, { message: 'Playback Authorization not found' })
    const settings = await ensureTimeSettings(db, user.id!)
    const acknowledgedAt = now()
    const day = viewingDayAt(acknowledgedAt, settings.timeZone, settings)
    if (input.sequence <= session.lastSequence || session.endedAt) {
      const usage = await dailyUsage(db, user.id!, day.localDate)
      const limitSeconds = (session.usageBucket === 'exempt' ? settings.safetyCapMinutes : day.allowanceMinutes) * 60
      const usedSeconds = session.usageBucket === 'exempt' ? usage.exemptSeconds : usage.restrictedSeconds
      return c.json({ accepted: false, sequence: session.lastSequence, remainingSeconds: Math.max(0, limitSeconds - usedSeconds), authorized: false })
    }
    const limitSeconds = (session.usageBucket === 'exempt' ? settings.safetyCapMinutes : day.allowanceMinutes) * 60
    const acknowledgedEpoch = epochSeconds(acknowledgedAt)
    const nextLeaseEpoch = acknowledgedEpoch + PLAYBACK_LEASE_SECONDS
    const results = await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO daily_usage_summaries (child_id, viewing_day, restricted_seconds, exempt_seconds, updated_at)
        SELECT child_id, ?,
          CASE WHEN usage_bucket = 'restricted' THEN MIN(
            MAX(0, MIN(?, lease_expires_at) - last_acknowledged_at),
            MAX(0, ? - COALESCE((SELECT restricted_seconds FROM daily_usage_summaries WHERE child_id = ? AND viewing_day = ?), 0))
          ) ELSE 0 END,
          CASE WHEN usage_bucket = 'exempt' THEN MIN(
            MAX(0, MIN(?, lease_expires_at) - last_acknowledged_at),
            MAX(0, ? - COALESCE((SELECT exempt_seconds FROM daily_usage_summaries WHERE child_id = ? AND viewing_day = ?), 0))
          ) ELSE 0 END, ?
        FROM playback_sessions
        WHERE id = ? AND child_id = ? AND ended_at IS NULL AND last_sequence < ? AND last_state = 'playing'
        ON CONFLICT(child_id, viewing_day) DO UPDATE SET
          restricted_seconds = CASE WHEN excluded.restricted_seconds > 0 THEN MIN(?, daily_usage_summaries.restricted_seconds + excluded.restricted_seconds) ELSE daily_usage_summaries.restricted_seconds END,
          exempt_seconds = CASE WHEN excluded.exempt_seconds > 0 THEN MIN(?, daily_usage_summaries.exempt_seconds + excluded.exempt_seconds) ELSE daily_usage_summaries.exempt_seconds END,
          updated_at = excluded.updated_at
      `).bind(day.localDate, acknowledgedEpoch, limitSeconds, user.id!, day.localDate,
        acknowledgedEpoch, limitSeconds, user.id!, day.localDate, acknowledgedEpoch,
        session.id, user.id!, input.sequence, limitSeconds, limitSeconds),
      c.env.DB.prepare(`
        UPDATE playback_sessions SET
          viewing_day = ?, last_sequence = ?, last_acknowledged_at = ?,
          last_state = CASE WHEN ? >= lease_expires_at OR ? = 'ended' THEN 'ended' ELSE ? END,
          lease_expires_at = CASE WHEN ? >= lease_expires_at OR ? = 'ended' THEN lease_expires_at ELSE ? END,
          ended_at = CASE WHEN ? >= lease_expires_at OR ? = 'ended' THEN ? ELSE NULL END
        WHERE id = ? AND child_id = ? AND ended_at IS NULL AND last_sequence < ?
      `).bind(day.localDate, input.sequence, acknowledgedEpoch, acknowledgedEpoch, input.state, input.state,
        acknowledgedEpoch, input.state, nextLeaseEpoch, acknowledgedEpoch, input.state, acknowledgedEpoch,
        session.id, user.id!, input.sequence),
    ])
    const accepted = Number(results[1].meta.changes ?? 0) > 0
    const [updatedSession, usage] = await Promise.all([
      db.query.playbackSessions.findFirst({ where: eq(schema.playbackSessions.id, session.id) }),
      dailyUsage(db, user.id!, day.localDate),
    ])
    const usedSeconds = session.usageBucket === 'exempt' ? usage.exemptSeconds : usage.restrictedSeconds
    const authorized = accepted && updatedSession?.endedAt === null && usedSeconds < limitSeconds
    if (accepted && !authorized && updatedSession?.endedAt === null) {
      await db.update(schema.playbackSessions).set({ lastState: 'ended', endedAt: acknowledgedAt }).where(and(eq(schema.playbackSessions.id, session.id), isNull(schema.playbackSessions.endedAt)))
    }
    return c.json({
      accepted,
      sequence: updatedSession?.lastSequence ?? session.lastSequence,
      remainingSeconds: Math.max(0, limitSeconds - usedSeconds),
      authorized,
      leaseExpiresAt: authorized ? updatedSession?.leaseExpiresAt.toISOString() : null,
    })
  })

  app.get('/api/child/channel/:id/videos', async c => channelOrPlaylist(c, 'channel'))
  app.get('/api/child/playlist/:id/videos', async c => channelOrPlaylist(c, 'playlist'))
  return app
}

async function ensureTimeSettings(db: ReturnType<typeof drizzle<typeof schema>>, childId: number) {
  let settings = await db.query.childTimeSettings.findFirst({ where: eq(schema.childTimeSettings.childId, childId) })
  if (!settings) {
    await db.insert(schema.childTimeSettings).values({ childId }).onConflictDoNothing()
    settings = await db.query.childTimeSettings.findFirst({ where: eq(schema.childTimeSettings.childId, childId) })
  }
  if (!settings) throw new HTTPException(500, { message: 'Unable to create time settings' })
  return settings
}

async function dailyUsage(db: ReturnType<typeof drizzle<typeof schema>>, childId: number, viewingDay: string) {
  const summary = await db.query.dailyUsageSummaries.findFirst({ where: and(eq(schema.dailyUsageSummaries.childId, childId), eq(schema.dailyUsageSummaries.viewingDay, viewingDay)) })
  return { restrictedSeconds: summary?.restrictedSeconds ?? 0, exemptSeconds: summary?.exemptSeconds ?? 0 }
}

function watchTimeStatus(allowanceSeconds: number, safetyCapSeconds: number, usage: { restrictedSeconds: number; exemptSeconds: number }) {
  return {
    usedSeconds: usage.restrictedSeconds,
    remainingSeconds: Math.max(0, allowanceSeconds - usage.restrictedSeconds),
    locked: usage.restrictedSeconds >= allowanceSeconds,
    restricted: {
      usedSeconds: usage.restrictedSeconds,
      remainingSeconds: Math.max(0, allowanceSeconds - usage.restrictedSeconds),
      locked: usage.restrictedSeconds >= allowanceSeconds,
    },
    exempt: {
      usedSeconds: usage.exemptSeconds,
      remainingSeconds: Math.max(0, safetyCapSeconds - usage.exemptSeconds),
      locked: usage.exemptSeconds >= safetyCapSeconds,
    },
  }
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
    return c.json({ channel: { id: item.id, channelId: item.channelId, title: item.channelTitle, thumbnail: item.channelThumbnail, isAvailable: item.isAvailable, contentRule: item.contentRule }, videos })
  }
  const item = await db.query.allowedPlaylists.findFirst({ where: and(eq(schema.allowedPlaylists.id, id), eq(schema.allowedPlaylists.childId, user.id!)) })
  if (!item) throw new HTTPException(404, { message: 'playlist not found' })
  const videos = await db.query.playlistVideos.findMany({ where: eq(schema.playlistVideos.playlistId, item.playlistId), orderBy: (table, { asc }) => [asc(table.position)] })
  if (await claimRefresh(db, 'playlist', item.id, item.lastFetchedAt, videos[0]?.fetchedAt)) {
    c.executionCtx.waitUntil(refreshVideos(c.env, kind, id, item.playlistId))
  }
  return c.json({ playlist: { id: item.id, playlistId: item.playlistId, title: item.playlistTitle, thumbnail: item.playlistThumbnail, isAvailable: item.isAvailable, contentRule: item.contentRule }, videos })
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

function epochSeconds(value: Date) {
  return Math.floor(value.getTime() / 1000)
}
