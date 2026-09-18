import { seriesNavigation } from './modules/series-navigation.ts'
import { database } from './database/client.ts'
import { registerJellyfinRoutes } from './modules/jellyfin.ts'
import { registerProviderRoutes } from './modules/providers.ts'
import { searchApprovedVideos } from './modules/content-search.ts'
import { viewingEvents } from './modules/viewing-events.ts'
import { registerPlaybackRoutes } from './modules/playback.ts'
import { registerEpisodeClaimRoutes } from './modules/episode-claims.ts'
import { registerTimePoolRoutes, poolStatuses } from './modules/time-pools.ts'
import { resolveUser, adminEmails, requireRole, type CurrentUser, type AppEnv } from './modules/identity.ts'
import { writeContentCache } from './modules/content-cache.ts'
import { endActivePlayback } from './modules/playback-ledger.ts'
import { approvedVideoMetadata, resolveApprovedVideos, videosWithResolvedRules, isShortDuration, excludeUnsupportedVideos } from './modules/catalog.ts'
import { ensureTimeSettings, dailyUsage, ensureDailyUsage, effectiveLimits, watchTimeStatus, adminWatchTimeStatus } from './modules/usage.ts'
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { and, count, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as v from 'valibot'
import * as schema from './database/schema.ts'
import { playbackPolicyAt } from './utils/playback-policy.ts'
import { syncApprovedContent } from './utils/content-sync.ts'
import { epochSeconds, isValidTimeZone, viewingDayAt } from './utils/viewing-day.ts'
import { parseYouTubeUrl } from './utils/youtube.ts'
import {
  fetchChannelMetadata,
  fetchPlaylistMetadata,
  fetchPlaylistVideosPage,
  fetchVideoMetadata,
  YouTubeApiError,
} from './utils/youtube-api.ts'

type ApiContext = Context<AppEnv>
const allowanceMinutes = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1440))
const clockMinute = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1440), v.multipleOf(15, 'Must be a 15-minute increment'))
const timeSettingsInput = v.pipe(v.object({
  timeZone: v.pipe(v.string(), v.trim(), v.minLength(1), v.check(isValidTimeZone, 'Invalid IANA time zone')),
  weekdayAllowanceMinutes: allowanceMinutes,
  weekendAllowanceMinutes: allowanceMinutes,
  safetyCapMinutes: allowanceMinutes,
  allowedStartMinute: v.optional(v.pipe(clockMinute, v.maxValue(1425)), 0),
  allowedEndMinute: v.optional(v.pipe(clockMinute, v.minValue(15)), 1440),
  breakAfterMinutes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(240), v.multipleOf(15)), 0),
  breakDurationMinutes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(5), v.maxValue(60), v.multipleOf(5)), 15),
  confirmReduction: v.optional(v.boolean(), false),
}), v.check(input => input.allowedStartMinute < input.allowedEndMinute, 'Viewing Window end must be after its start'))
const contentRule = v.picklist(['restricted', 'exempt'])
const extensionMinutes = v.picklist([15, 30, 60])
const positiveInteger = v.pipe(v.number(), v.integer(), v.minValue(1))
const videoIdInput = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64))
const approvedContentType = v.picklist(['channel', 'playlist', 'video'])
const tagsInput = v.pipe(v.array(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(24))), v.maxLength(8))
const profileInput = v.object({
  displayName: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(40)),
  avatarUrl: v.optional(v.union([v.pipe(v.string(), v.trim(), v.url(), v.maxLength(500)), v.literal('')]), ''),
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
    if (error instanceof YouTubeApiError) return c.json({ message: error.message }, 502)
    if (error instanceof v.ValiError) return c.json({ message: 'Invalid request', issues: error.issues }, 400)
    console.error(JSON.stringify({ event: 'request_error', message: error.message }))
    return c.json({ message: 'Internal server error' }, 500)
  })

  app.get('/api/auth/session', c => c.json({ user: c.get('user') }))
  registerEpisodeClaimRoutes(app, now)
  registerTimePoolRoutes(app, now)
  registerJellyfinRoutes(app, now)

  app.get('/api/admin/children', async c => {
    requireRole(c.get('user'), 'admin')
    const db = database(c.env.DB)
    const admins = adminEmails(c.env)
    const [list, channelCounts, playlistCounts, videoCounts] = await Promise.all([
      db.query.children.findMany(),
      db.select({ childId: schema.allowedChannels.childId, count: count() }).from(schema.allowedChannels).groupBy(schema.allowedChannels.childId),
      db.select({ childId: schema.allowedPlaylists.childId, count: count() }).from(schema.allowedPlaylists).groupBy(schema.allowedPlaylists.childId),
      db.select({ childId: schema.allowedVideos.childId, count: count() }).from(schema.allowedVideos).groupBy(schema.allowedVideos.childId),
    ])
    const counts = (rows: Array<{ childId: number; count: number }>) => new Map(rows.map(row => [row.childId, row.count]))
    const channels = counts(channelCounts), playlists = counts(playlistCounts), videos = counts(videoCounts)
    const children = list.map(child => ({ ...child, isAdmin: admins.has(child.email), stats: {
      channels: channels.get(child.id) ?? 0, playlists: playlists.get(child.id) ?? 0, videos: videos.get(child.id) ?? 0,
    } }))
    return c.json({ children })
  })

  app.put('/api/admin/children/:id/profile', async c => {
    const { db, childId } = await adminChild(c)
    const input = v.parse(profileInput, await c.req.json())
    await db.update(schema.children).set({ displayName: input.displayName, avatarUrl: input.avatarUrl || null }).where(eq(schema.children.id, childId))
    const child = await db.query.children.findFirst({ where: eq(schema.children.id, childId) })
    return c.json({ child })
  })

  app.get('/api/admin/children/:id/time-settings', async c => {
    const { db, childId } = await adminChild(c)
    const settings = await ensureTimeSettings(db, childId)
    return c.json({ settings, viewingDay: viewingDayAt(now(), settings.timeZone, settings) })
  })

  app.put('/api/admin/children/:id/time-settings', async c => {
    const { db, childId } = await adminChild(c)
    const input = v.parse(timeSettingsInput, await c.req.json())
    const current = await ensureTimeSettings(db, childId)
    const instant = now()
    const currentDay = viewingDayAt(instant, current.timeZone, current)
    const usage = await dailyUsage(db, childId, currentDay.localDate, instant)
    const proposedDay = viewingDayAt(instant, input.timeZone, input)
    const restrictedReduction = proposedDay.allowanceMinutes < currentDay.allowanceMinutes
      && usage.restrictedSeconds >= proposedDay.allowanceMinutes * 60
    const exemptReduction = input.safetyCapMinutes < current.safetyCapMinutes
      && usage.exemptSeconds >= input.safetyCapMinutes * 60
    if ((restrictedReduction || exemptReduction) && !input.confirmReduction) {
      return c.json({
        message: 'Current usage meets or exceeds the proposed allowance. Saving will immediately end affected Active Playback.',
        requiresConfirmation: true,
        affectedBuckets: [restrictedReduction ? 'restricted' : null, exemptReduction ? 'exempt' : null].filter(Boolean),
      }, 409)
    }
    const { confirmReduction: _confirmReduction, ...settingsInput } = input
    // Settle the pending interval using the previous Break Cycle before changing
    // its threshold. The acknowledged total may already meet the new threshold.
    if (input.breakAfterMinutes !== current.breakAfterMinutes) {
      await endActivePlayback(c.env.DB, childId, instant, { settings: current })
    }
    await db.insert(schema.childTimeSettings).values({ childId, ...settingsInput, updatedAt: instant }).onConflictDoUpdate({
      target: schema.childTimeSettings.childId,
      set: { ...settingsInput, updatedAt: instant },
    })
    await dailyUsage(db, childId, proposedDay.localDate, instant)
    if (input.breakAfterMinutes > 0) {
      await c.env.DB.prepare(`UPDATE daily_usage_summaries SET break_until = ?, updated_at = ?
        WHERE child_id = ? AND viewing_day = ? AND break_cycle_seconds >= ? AND break_until IS NULL`)
        .bind(epochSeconds(instant) + input.breakDurationMinutes * 60, epochSeconds(instant), childId, proposedDay.localDate, input.breakAfterMinutes * 60).run()
    }
    const savedUsage = await dailyUsage(db, childId, proposedDay.localDate, instant)
    const savedPolicy = playbackPolicyAt(instant, input, savedUsage)
    if (restrictedReduction || exemptReduction || savedPolicy.blocked) {
      const buckets = [restrictedReduction ? 'restricted' : null, exemptReduction ? 'exempt' : null].filter(Boolean) as string[]
      await endActivePlayback(c.env.DB, childId, instant, { settings: current, buckets: savedPolicy.blocked ? undefined : buckets })
    }
    const settings = await db.query.childTimeSettings.findFirst({ where: eq(schema.childTimeSettings.childId, childId) })
    return c.json({ settings, viewingDay: viewingDayAt(instant, input.timeZone, input) })
  })

  app.get('/api/admin/children/:id/watch-time', async c => {
    const { db, childId } = await adminChild(c)
    const settings = await ensureTimeSettings(db, childId)
    const day = viewingDayAt(now(), settings.timeZone, settings)
    const usage = await dailyUsage(db, childId, day.localDate, now())
    return c.json({ ...adminWatchTimeStatus(day.localDate, day.allowanceMinutes, settings.safetyCapMinutes, usage, settings.cartoonAllowanceMinutes), policy: playbackPolicyAt(now(), settings, usage) })
  })

  app.post('/api/admin/children/:id/watch-time/extensions', async c => {
    const { db, childId } = await adminChild(c)
    const input = v.parse(v.object({ bucket: v.picklist(['restricted', 'exempt']), minutes: extensionMinutes }), await c.req.json())
    const settings = await ensureTimeSettings(db, childId)
    const day = viewingDayAt(now(), settings.timeZone, settings)
    await ensureDailyUsage(db, childId, day.localDate)
    await c.env.DB.prepare(`UPDATE daily_usage_summaries SET ${input.bucket === 'restricted' ? 'restricted_extension_minutes' : 'exempt_extension_minutes'} = ${input.bucket === 'restricted' ? 'restricted_extension_minutes' : 'exempt_extension_minutes'} + ?, updated_at = ? WHERE child_id = ? AND viewing_day = ?`)
      .bind(input.minutes, epochSeconds(now()), childId, day.localDate).run()
    const usage = await dailyUsage(db, childId, day.localDate, now())
    return c.json({ ...adminWatchTimeStatus(day.localDate, day.allowanceMinutes, settings.safetyCapMinutes, usage, settings.cartoonAllowanceMinutes), policy: playbackPolicyAt(now(), settings, usage) })
  })

  app.put('/api/admin/children/:id/watch-time/restricted-unlock', async c => {
    const { db, childId } = await adminChild(c)
    const input = v.parse(v.object({ unlocked: v.boolean() }), await c.req.json())
    const settings = await ensureTimeSettings(db, childId)
    const day = viewingDayAt(now(), settings.timeZone, settings)
    await ensureDailyUsage(db, childId, day.localDate)
    await db.update(schema.dailyUsageSummaries).set({ restrictedUnlocked: input.unlocked, updatedAt: now() })
      .where(and(eq(schema.dailyUsageSummaries.childId, childId), eq(schema.dailyUsageSummaries.viewingDay, day.localDate)))
    const usage = await dailyUsage(db, childId, day.localDate, now())
    return c.json({ ...adminWatchTimeStatus(day.localDate, day.allowanceMinutes, settings.safetyCapMinutes, usage, settings.cartoonAllowanceMinutes), policy: playbackPolicyAt(now(), settings, usage) })
  })

  app.put('/api/admin/children/:id/watch-time/viewing-pause', async c => {
    const { db, childId } = await adminChild(c)
    const input = v.parse(v.object({ paused: v.boolean() }), await c.req.json())
    const settings = await ensureTimeSettings(db, childId)
    const instant = now()
    const day = viewingDayAt(instant, settings.timeZone, settings)
    await ensureDailyUsage(db, childId, day.localDate)
    await db.update(schema.dailyUsageSummaries).set({ playbackPaused: input.paused, updatedAt: instant })
      .where(and(eq(schema.dailyUsageSummaries.childId, childId), eq(schema.dailyUsageSummaries.viewingDay, day.localDate)))
    if (input.paused) await endActivePlayback(c.env.DB, childId, instant)
    const usage = await dailyUsage(db, childId, day.localDate, instant)
    return c.json({ ...adminWatchTimeStatus(day.localDate, day.allowanceMinutes, settings.safetyCapMinutes, usage, settings.cartoonAllowanceMinutes), policy: playbackPolicyAt(instant, settings, usage) })
  })

  app.get('/api/admin/children/:id/viewing-events', async c => {
    const { db, childId } = await adminChild(c)
    const settings = await ensureTimeSettings(db, childId)
    return c.json(await viewingEvents(c.env.DB, childId, settings.timeZone, now(), c.req.query('cursor')))
  })

  app.get('/api/admin/children/:id/usage', async c => {
    const { db, childId } = await adminChild(c)
    const days = v.parse(v.picklist([7, 30]), Number(c.req.query('days') ?? 7))
    const settings = await ensureTimeSettings(db, childId)
    const currentDay = viewingDayAt(now(), settings.timeZone, settings).localDate
    const viewingDays = recentViewingDays(currentDay, days)
    const rows = await db.query.dailyUsageSummaries.findMany({
      where: and(eq(schema.dailyUsageSummaries.childId, childId), gte(schema.dailyUsageSummaries.viewingDay, viewingDays[0])),
      orderBy: [desc(schema.dailyUsageSummaries.viewingDay)],
    })
    const byDay = new Map(rows.map(row => [row.viewingDay, row]))
    const poolUsage = await db.query.timePoolUsage.findMany({ where: and(eq(schema.timePoolUsage.childId, childId), gte(schema.timePoolUsage.viewingDay, viewingDays[0])) })
    return c.json({ days: viewingDays.map(viewingDay => {
      const usage = byDay.get(viewingDay)
      const restrictedSeconds = usage?.restrictedSeconds ?? 0
      const exemptSeconds = usage?.exemptSeconds ?? 0
      const cartoonSeconds = usage?.cartoonSeconds ?? 0
      return { viewingDay, restrictedSeconds, exemptSeconds, cartoonSeconds, totalSeconds: poolUsage.filter(row => row.viewingDay === viewingDay).reduce((total, row) => total + row.usedSeconds, 0) }
    }) })
  })

  app.get('/api/admin/children/:id/content', async c => {
    requireRole(c.get('user'), 'admin')
    const childId = numericId(c.req.param('id'))
    const db = database(c.env.DB)
    const child = await db.query.children.findFirst({ where: eq(schema.children.id, childId) })
    if (!child) throw new HTTPException(404, { message: 'Child not found' })
    const [channels, playlists, videos, videoRules] = await Promise.all([
      db.query.allowedChannels.findMany({ where: eq(schema.allowedChannels.childId, childId) }),
      db.query.allowedPlaylists.findMany({ where: eq(schema.allowedPlaylists.childId, childId) }),
      db.query.allowedVideos.findMany({ where: eq(schema.allowedVideos.childId, childId) }),
      db.query.videoContentRules.findMany({ where: eq(schema.videoContentRules.childId, childId) }),
    ])
    return c.json({ child: { id: child.id, email: child.email, displayName: child.displayName, avatarUrl: child.avatarUrl }, channels, playlists, videos, videoRules })
  })

  app.get('/api/admin/children/:id/content/:type/:contentId/videos', async c => {
    const { db, childId } = await adminChild(c)
    const type = v.parse(v.picklist(['channel', 'playlist']), c.req.param('type'))
    const contentId = numericId(c.req.param('contentId'))
    if (type === 'channel') {
      const source = await db.query.allowedChannels.findFirst({ where: and(eq(schema.allowedChannels.id, contentId), eq(schema.allowedChannels.childId, childId)) })
      if (!source) throw new HTTPException(404, { message: 'Approved Content not found' })
      let videos = await db.query.channelVideos.findMany({ where: eq(schema.channelVideos.channelId, source.channelId), orderBy: (table, { asc }) => [asc(table.position)] })
      if (!videos.length) {
        await syncApprovedContent(c.env, { target: { type: 'channel', id: source.id }, force: true, now: now() })
        videos = await db.query.channelVideos.findMany({ where: eq(schema.channelVideos.channelId, source.channelId), orderBy: (table, { asc }) => [asc(table.position)] })
      }
      return c.json({ videos })
    }
    const source = await db.query.allowedPlaylists.findFirst({ where: and(eq(schema.allowedPlaylists.id, contentId), eq(schema.allowedPlaylists.childId, childId)) })
    if (!source) throw new HTTPException(404, { message: 'Approved Content not found' })
    let videos = await db.query.playlistVideos.findMany({ where: eq(schema.playlistVideos.playlistId, source.playlistId), orderBy: (table, { asc }) => [asc(table.position)] })
    if (!videos.length) {
      await syncApprovedContent(c.env, { target: { type: 'playlist', id: source.id }, force: true, now: now() })
      videos = await db.query.playlistVideos.findMany({ where: eq(schema.playlistVideos.playlistId, source.playlistId), orderBy: (table, { asc }) => [asc(table.position)] })
    }
    return c.json({ videos })
  })

  app.post('/api/admin/children/:id/content/:type/:contentId/sync', async c => {
    const { db, childId } = await adminChild(c)
    const type = v.parse(approvedContentType, c.req.param('type'))
    const contentId = numericId(c.req.param('contentId'))
    const table = type === 'channel' ? schema.allowedChannels : type === 'playlist' ? schema.allowedPlaylists : schema.allowedVideos
    const content = await db.select({ id: table.id }).from(table).where(and(eq(table.id, contentId), eq(table.childId, childId))).get()
    if (!content) throw new HTTPException(404, { message: 'Approved Content not found' })
    const result = await syncApprovedContent(c.env, { target: { type, id: contentId }, force: true, now: now() })
    if (!result.synced) throw new HTTPException(502, { message: 'Approved Content could not be synced' })
    return c.json({ syncedAt: now().toISOString(), result })
  })

  app.put('/api/admin/children/:id/video-rules/:videoId', async c => {
    const { db, childId } = await adminChild(c)
    const videoId = v.parse(videoIdInput, c.req.param('videoId'))
    const input = v.parse(v.object({ rule: contentRule, sourceType: v.picklist(['channel', 'playlist']), sourceId: positiveInteger }), await c.req.json())
    const membership = input.sourceType === 'channel'
      ? await db.select({ videoId: schema.channelVideos.videoId, videoTitle: schema.channelVideos.videoTitle, videoThumbnail: schema.channelVideos.videoThumbnail, duration: schema.channelVideos.duration, channelTitle: schema.channelVideos.channelTitle })
          .from(schema.allowedChannels).innerJoin(schema.channelVideos, eq(schema.channelVideos.channelId, schema.allowedChannels.channelId))
          .where(and(eq(schema.allowedChannels.id, input.sourceId), eq(schema.allowedChannels.childId, childId), eq(schema.allowedChannels.isAvailable, true), eq(schema.channelVideos.videoId, videoId))).get()
      : await db.select({ videoId: schema.playlistVideos.videoId, videoTitle: schema.playlistVideos.videoTitle, videoThumbnail: schema.playlistVideos.videoThumbnail, duration: schema.playlistVideos.duration, channelTitle: schema.playlistVideos.channelTitle })
          .from(schema.allowedPlaylists).innerJoin(schema.playlistVideos, eq(schema.playlistVideos.playlistId, schema.allowedPlaylists.playlistId))
          .where(and(eq(schema.allowedPlaylists.id, input.sourceId), eq(schema.allowedPlaylists.childId, childId), eq(schema.allowedPlaylists.isAvailable, true), eq(schema.playlistVideos.videoId, videoId))).get()
    if (!membership) throw new HTTPException(404, { message: 'Video membership is not available from this Approved Content' })
    await db.insert(schema.videoContentRules).values({ childId, ...membership, contentRule: input.rule }).onConflictDoUpdate({
      target: [schema.videoContentRules.childId, schema.videoContentRules.videoId],
      set: { contentRule: input.rule, videoTitle: membership.videoTitle, videoThumbnail: membership.videoThumbnail, duration: membership.duration, channelTitle: membership.channelTitle },
    })
    return c.json({ videoRule: await db.query.videoContentRules.findFirst({ where: and(eq(schema.videoContentRules.childId, childId), eq(schema.videoContentRules.videoId, videoId)) }) })
  })

  app.post('/api/admin/children/:id/recommendations', async c => {
    const { db, childId } = await adminChild(c)
    const input = v.parse(v.object({ videoId: videoIdInput }), await c.req.json())
    if (!await approvedVideoMetadata(db, childId, input.videoId)) throw new HTTPException(404, { message: 'Video is not available from Approved Content' })
    await db.insert(schema.videoRecommendations).values({ childId, videoId: input.videoId }).onConflictDoUpdate({
      target: [schema.videoRecommendations.childId, schema.videoRecommendations.videoId],
      set: { recommendedAt: now(), seenAt: null },
    })
    return c.json({ recommended: true })
  })

  app.delete('/api/admin/children/:id/video-rules/:videoId', async c => {
    const { db, childId } = await adminChild(c)
    const videoId = v.parse(videoIdInput, c.req.param('videoId'))
    await db.delete(schema.videoContentRules).where(and(eq(schema.videoContentRules.childId, childId), eq(schema.videoContentRules.videoId, videoId)))
    return c.json({ success: true })
  })

  app.put('/api/admin/children/:id/content/:type/:contentId/rule', async c => {
    const { db, childId } = await adminChild(c)
    const type = v.parse(approvedContentType, c.req.param('type'))
    const contentId = numericId(c.req.param('contentId'))
    const input = v.parse(v.object({ rule: contentRule }), await c.req.json())
    const table = type === 'channel' ? schema.allowedChannels : type === 'playlist' ? schema.allowedPlaylists : schema.allowedVideos
    const updated = await db.update(table).set({ contentRule: input.rule })
      .where(and(eq(table.id, contentId), eq(table.childId, childId)))
      .returning({ id: table.id, contentRule: table.contentRule })
    if (!updated.length) throw new HTTPException(404, { message: 'Approved Content not found' })
    return c.json({ content: updated[0] })
  })

  app.put('/api/admin/children/:id/content/:type/:contentId/tags', async c => {
    const { db, childId } = await adminChild(c)
    const type = v.parse(approvedContentType, c.req.param('type'))
    const contentId = numericId(c.req.param('contentId'))
    const input = v.parse(v.object({ tags: tagsInput }), await c.req.json())
    const tags = [...new Set(input.tags.map(tag => tag.trim()).filter(Boolean))]
    const table = type === 'channel' ? schema.allowedChannels : type === 'playlist' ? schema.allowedPlaylists : schema.allowedVideos
    const updated = await db.update(table).set({ tags }).where(and(eq(table.id, contentId), eq(table.childId, childId))).returning({ id: table.id, tags: table.tags })
    if (!updated.length) throw new HTTPException(404, { message: 'Approved Content not found' })
    return c.json({ content: updated[0] })
  })

  app.post('/api/admin/children/:id/content/copy', async c => {
    const { db, childId } = await adminChild(c)
    const input = v.parse(v.object({ sourceChildId: positiveInteger }), await c.req.json())
    if (input.sourceChildId === childId) throw new HTTPException(400, { message: 'Choose a different source Child' })
    const source = await db.query.children.findFirst({ where: eq(schema.children.id, input.sourceChildId) })
    if (!source) throw new HTTPException(404, { message: 'Source Child not found' })
    const counts = await copyApprovedContent(db, input.sourceChildId, childId)
    return c.json({ copied: counts })
  })

  app.post('/api/admin/content/add', async c => {
    requireRole(c.get('user'), 'admin')
    const input = v.parse(v.object({ childId: positiveInteger, url: v.pipe(v.string(), v.url()) }), await c.req.json())
    const db = database(c.env.DB)
    const child = await db.query.children.findFirst({ where: eq(schema.children.id, input.childId) })
    if (!child) throw new HTTPException(404, { message: 'Child not found' })
    const parsed = parseYouTubeUrl(input.url)
    if (!parsed) throw new HTTPException(400, { message: 'Invalid YouTube URL' })
    if (parsed.type === 'channel' && parsed.id.startsWith('c/')) {
      throw new HTTPException(400, { message: 'Use the channel @handle or /channel/ URL to conserve YouTube API quota' })
    }
    if (parsed.type === 'video') {
      const item = await fetchVideoMetadata(parsed.id, c.env.YOUTUBE_API_KEY)
      if (isShortDuration(item.duration)) throw new HTTPException(400, { message: 'Videos of 3 minutes or less are not supported' })
      if (!item.embeddable) throw new HTTPException(400, { message: 'This video does not allow embedded playback' })
      const values = { childId: input.childId, videoId: item.videoId, videoTitle: item.title, videoDescription: item.description, videoThumbnail: item.thumbnail, duration: item.duration, channelTitle: item.channelTitle, publishedAt: item.publishedAt, lastFetchedAt: now(), isAvailable: true }
      const [content] = await db.insert(schema.allowedVideos).values(values).onConflictDoUpdate({
        target: [schema.allowedVideos.childId, schema.allowedVideos.videoId],
        set: { videoTitle: item.title, videoDescription: item.description, videoThumbnail: item.thumbnail, duration: item.duration, channelTitle: item.channelTitle, publishedAt: item.publishedAt, lastFetchedAt: now(), isAvailable: true },
      }).returning()
      await db.insert(schema.videoRecommendations).values({ childId: input.childId, videoId: item.videoId }).onConflictDoUpdate({
        target: [schema.videoRecommendations.childId, schema.videoRecommendations.videoId],
        set: { recommendedAt: now(), seenAt: null },
      })
      return c.json({ type: 'video', content })
    }
    if (parsed.type === 'playlist') {
      const item = await fetchPlaylistMetadata(parsed.id, c.env.YOUTUBE_API_KEY)
      const [content] = await db.insert(schema.allowedPlaylists).values({ childId: input.childId, playlistId: item.playlistId, playlistTitle: item.title, playlistThumbnail: item.thumbnail, lastFetchedAt: null, isAvailable: true }).onConflictDoUpdate({
        target: [schema.allowedPlaylists.childId, schema.allowedPlaylists.playlistId],
        set: { playlistTitle: item.title, playlistThumbnail: item.thumbnail, isAvailable: true },
      }).returning()
      return c.json({ type: 'playlist', content })
    }
    const item = await fetchChannelMetadata(parsed.id, c.env.YOUTUBE_API_KEY)
    const [content] = await db.insert(schema.allowedChannels).values({ childId: input.childId, channelId: item.channelId, uploadsPlaylistId: item.uploadsPlaylistId, channelTitle: item.title, channelThumbnail: item.thumbnail, lastFetchedAt: null, isAvailable: true }).onConflictDoUpdate({
      target: [schema.allowedChannels.childId, schema.allowedChannels.channelId],
      set: { uploadsPlaylistId: item.uploadsPlaylistId, channelTitle: item.title, channelThumbnail: item.thumbnail, isAvailable: true },
    }).returning()
    return c.json({ type: 'channel', content })
  })

  app.delete('/api/admin/content/:id', async c => {
    requireRole(c.get('user'), 'admin')
    const id = numericId(c.req.param('id'))
    const type = c.req.query('type')
    const db = database(c.env.DB)
    const table = type === 'channel' ? schema.allowedChannels : type === 'playlist' ? schema.allowedPlaylists : type === 'video' ? schema.allowedVideos : null
    if (!table) throw new HTTPException(400, { message: 'Invalid content type' })
    const content = await db.select().from(table).where(eq(table.id, id)).get()
    if (!content) throw new HTTPException(404, { message: 'Content not found' })
    const child = await db.query.children.findFirst({ where: eq(schema.children.id, content.childId) })
    if (!child) throw new HTTPException(403, { message: 'Forbidden' })
    await db.delete(table).where(eq(table.id, id))
    return c.json({ success: true })
  })

  app.get('/api/child/recommendations/count', async c => {
    const user = c.get('user')
    const db = database(c.env.DB)
    const result = await db.select({ count: count() }).from(schema.videoRecommendations).where(and(eq(schema.videoRecommendations.childId, user.id!), isNull(schema.videoRecommendations.seenAt))).get()
    return c.json({ count: result?.count ?? 0 })
  })

  app.get('/api/child/search', async c => {
    const childId = c.get('user').id
    const query = v.parse(v.pipe(v.string(), v.trim(), v.maxLength(200)), c.req.query('q') ?? '')
    const tag = v.parse(v.pipe(v.string(), v.trim(), v.maxLength(100)), c.req.query('tag') ?? '')
    const page = v.parse(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000)), Number(c.req.query('page') ?? '0'))
    const db = database(c.env.DB)
    const result = await searchApprovedVideos(db, childId, query, tag, page)
    const [favoriteVideoIds, viewing] = await Promise.all([favoriteVideoIdsFor(db, childId, result.videos), childViewingStatus(db, childId, now())])
    return c.json({ ...result, favoriteVideoIds, ...viewing })
  })

  app.get('/api/child/browse', async c => {
    const user = c.get('user')
    const db = database(c.env.DB)
    const [channels, playlists, videos, settings, favoriteRows, progressRows, recommendationRows] = await Promise.all([
      db.query.allowedChannels.findMany({ where: eq(schema.allowedChannels.childId, user.id!) }),
      db.query.allowedPlaylists.findMany({ where: eq(schema.allowedPlaylists.childId, user.id!) }),
      db.query.allowedVideos.findMany({ where: eq(schema.allowedVideos.childId, user.id!) }),
      ensureTimeSettings(db, user.id!),
      db.query.favoriteVideos.findMany({ where: eq(schema.favoriteVideos.childId, user.id!) }),
      db.query.playbackProgress.findMany({ where: eq(schema.playbackProgress.childId, user.id!), orderBy: (table, { desc }) => [desc(table.updatedAt)], limit: 10 }),
      db.query.videoRecommendations.findMany({ where: and(eq(schema.videoRecommendations.childId, user.id!), isNull(schema.videoRecommendations.seenAt)), orderBy: (table, { desc }) => [desc(table.recommendedAt)], limit: 10 }),
    ])
    const filteredVideos = excludeUnsupportedVideos(videos)
    if (filteredVideos.rejectedVideoIds.length) {
      await db.delete(schema.allowedVideos).where(and(eq(schema.allowedVideos.childId, user.id), inArray(schema.allowedVideos.videoId, filteredVideos.rejectedVideoIds)))
    }
    const metadata = await resolveApprovedVideos(db, user.id, [...favoriteRows, ...progressRows, ...recommendationRows, ...filteredVideos.videos].map(row => row.videoId))
    const available = (id: string) => { const video = metadata.get(id); return video?.supported ? video : null }
    const favorites = favoriteRows.flatMap(row => available(row.videoId) ? [available(row.videoId)!] : [])
    const continueWatching = progressRows.flatMap(row => available(row.videoId) ? [{ ...available(row.videoId)!, ...row }] : [])
    const recommendations = recommendationRows.flatMap(row => available(row.videoId) ? [available(row.videoId)!] : [])
    const day = viewingDayAt(now(), settings.timeZone, settings)
    const instant = now()
    const usage = await dailyUsage(db, user.id, day.localDate, instant)
    return c.json({
      seriesNavigation: await seriesNavigation(c.env.DB, user.id),
      channels, playlists, videos: filteredVideos.videos.map(video => ({ ...video, usageBucket: metadata.get(video.videoId)?.usageBucket ?? video.contentRule, timePoolId: metadata.get(video.videoId)?.timePoolId, timePoolName: metadata.get(video.videoId)?.timePoolName, timePoolConflict: metadata.get(video.videoId)?.timePoolConflict, requiresClaim: metadata.get(video.videoId)?.requiresClaim })), recommendations, favorites, continueWatching,
      recommendationCount: recommendations.length,
      favoriteVideoIds: favorites.map(item => item.videoId),
      watchTime: { ...watchTimeStatus(...effectiveLimits(day.allowanceMinutes, settings.safetyCapMinutes, usage), usage, settings.cartoonAllowanceMinutes), pools: await poolStatuses(db, user.id, instant) },
      policy: playbackPolicyAt(instant, settings, usage),
    })
  })

  app.post('/api/child/favorites', async c => {
    const user = c.get('user')
    const input = v.parse(v.object({ videoId: videoIdInput }), await c.req.json())
    const db = database(c.env.DB)
    if (!await approvedVideoMetadata(db, user.id!, input.videoId)) throw new HTTPException(403, { message: 'Video is not Approved Content' })
    await db.insert(schema.favoriteVideos).values({ childId: user.id!, videoId: input.videoId }).onConflictDoNothing()
    return c.json({ favorite: true })
  })

  app.delete('/api/child/favorites/:videoId', async c => {
    const user = c.get('user')
    const videoId = v.parse(videoIdInput, c.req.param('videoId'))
    const db = database(c.env.DB)
    await db.delete(schema.favoriteVideos).where(and(eq(schema.favoriteVideos.childId, user.id!), eq(schema.favoriteVideos.videoId, videoId)))
    return c.json({ favorite: false })
  })

  registerProviderRoutes(app)
  registerPlaybackRoutes(app, now)

  app.get('/api/child/channel/:id/videos', async c => channelOrPlaylist(c, 'channel', now()))
  app.get('/api/child/playlist/:id/videos', async c => channelOrPlaylist(c, 'playlist', now()))
  return app
}

async function adminChild(c: ApiContext) {
  requireRole(c.get('user'), 'admin')
  const childId = numericId(c.req.param('id'))
  const db = database(c.env.DB)
  const child = await db.query.children.findFirst({ where: eq(schema.children.id, childId) })
  if (!child) throw new HTTPException(404, { message: 'Child not found' })
  return { db, childId, child }
}

function recentViewingDays(currentDay: string, count: number) {
  const [year, month, day] = currentDay.split('-').map(Number)
  const anchor = Date.UTC(year, month - 1, day)
  return Array.from({ length: count }, (_, index) => new Date(anchor - (count - index - 1) * 86_400_000).toISOString().slice(0, 10))
}

async function copyApprovedContent(db: ReturnType<typeof drizzle<typeof schema>>, sourceChildId: number, targetChildId: number) {
  const [channels, playlists, videos, videoRules] = await Promise.all([
    db.query.allowedChannels.findMany({ where: eq(schema.allowedChannels.childId, sourceChildId) }),
    db.query.allowedPlaylists.findMany({ where: eq(schema.allowedPlaylists.childId, sourceChildId) }),
    db.query.allowedVideos.findMany({ where: eq(schema.allowedVideos.childId, sourceChildId) }),
    db.query.videoContentRules.findMany({ where: eq(schema.videoContentRules.childId, sourceChildId) }),
  ])
  for (const item of channels) {
    const fields = {
      uploadsPlaylistId: item.uploadsPlaylistId, channelTitle: item.channelTitle, channelThumbnail: item.channelThumbnail,
      lastFetchedAt: item.lastFetchedAt, nextPageToken: item.nextPageToken,
      isAvailable: item.isAvailable, contentRule: item.contentRule, tags: item.tags,
    }
    await db.insert(schema.allowedChannels).values({ childId: targetChildId, channelId: item.channelId, ...fields }).onConflictDoUpdate({
      target: [schema.allowedChannels.childId, schema.allowedChannels.channelId], set: fields,
    })
  }
  for (const item of playlists) {
    const fields = {
      playlistTitle: item.playlistTitle, playlistThumbnail: item.playlistThumbnail,
      lastFetchedAt: item.lastFetchedAt, nextPageToken: item.nextPageToken,
      isAvailable: item.isAvailable, contentRule: item.contentRule, tags: item.tags, cartoonPool: item.cartoonPool,
    }
    await db.insert(schema.allowedPlaylists).values({ childId: targetChildId, playlistId: item.playlistId, ...fields }).onConflictDoUpdate({
      target: [schema.allowedPlaylists.childId, schema.allowedPlaylists.playlistId], set: fields,
    })
  }
  for (const item of videos) {
    const fields = {
      videoTitle: item.videoTitle, videoDescription: item.videoDescription, videoThumbnail: item.videoThumbnail,
      duration: item.duration, channelTitle: item.channelTitle, publishedAt: item.publishedAt,
      lastFetchedAt: item.lastFetchedAt, isAvailable: item.isAvailable, contentRule: item.contentRule, tags: item.tags,
    }
    await db.insert(schema.allowedVideos).values({ childId: targetChildId, videoId: item.videoId, ...fields }).onConflictDoUpdate({
      target: [schema.allowedVideos.childId, schema.allowedVideos.videoId], set: fields,
    })
  }
  for (const item of videoRules) {
    const fields = {
      contentRule: item.contentRule, videoTitle: item.videoTitle, videoThumbnail: item.videoThumbnail,
      duration: item.duration, channelTitle: item.channelTitle,
    }
    await db.insert(schema.videoContentRules).values({ childId: targetChildId, videoId: item.videoId, ...fields }).onConflictDoUpdate({
      target: [schema.videoContentRules.childId, schema.videoContentRules.videoId], set: fields,
    })
  }
  return { channels: channels.length, playlists: playlists.length, videos: videos.length, videoRules: videoRules.length }
}

async function favoriteVideoIdsFor(db: ReturnType<typeof drizzle<typeof schema>>, childId: number, videos: Array<{ videoId: string }>) {
  if (!videos.length) return []
  const rows = await db.query.favoriteVideos.findMany({ where: and(eq(schema.favoriteVideos.childId, childId), inArray(schema.favoriteVideos.videoId, videos.map(video => video.videoId))) })
  return rows.map(row => row.videoId)
}

async function unlockedVideoIdsFor(binding: D1Database, childId: number, videos: Array<{ videoId: string; requiresClaim?: boolean }>) {
  const ids = videos.filter(video => video.requiresClaim).map(video => video.videoId)
  if (!ids.length) return []
  const rows = await binding.prepare('SELECT video_id AS videoId FROM episode_unlocks WHERE child_id = ? AND video_id IN (SELECT value FROM json_each(?))')
    .bind(childId, JSON.stringify(ids)).all<{ videoId: string }>()
  return rows.results.map(row => row.videoId)
}

async function childViewingStatus(db: ReturnType<typeof drizzle<typeof schema>>, childId: number, instant: Date) {
  const settings = await ensureTimeSettings(db, childId)
  const day = viewingDayAt(instant, settings.timeZone, settings)
  const usage = await dailyUsage(db, childId, day.localDate, instant)
  return {
    watchTime: { ...watchTimeStatus(...effectiveLimits(day.allowanceMinutes, settings.safetyCapMinutes, usage), usage, settings.cartoonAllowanceMinutes), pools: await poolStatuses(db, childId, instant) },
    policy: playbackPolicyAt(instant, settings, usage),
  }
}

async function channelOrPlaylist(c: ApiContext, kind: 'channel' | 'playlist', instant: Date) {
  const user = c.get('user')
  const id = numericId(c.req.param('id'))
  const pageToken = v.parse(v.optional(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(500))), c.req.query('pageToken'))
  const page = v.parse(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1000)), Number(c.req.query('page') ?? '0'))
  const query = v.parse(v.pipe(v.string(), v.trim(), v.maxLength(200)), c.req.query('q') ?? '')
  const refresh = c.req.query('refresh') === 'true'
  const db = database(c.env.DB)

  const source = kind === 'channel'
    ? await db.query.allowedChannels.findFirst({ where: and(eq(schema.allowedChannels.id, id), eq(schema.allowedChannels.childId, user.id)) }).then(item => item && ({
        id: item.id, externalId: item.channelId, fetchPlaylistId: item.uploadsPlaylistId, title: item.channelTitle,
        thumbnail: item.channelThumbnail, isAvailable: item.isAvailable, contentRule: item.contentRule, tags: item.tags,
      }))
    : await db.query.allowedPlaylists.findFirst({ where: and(eq(schema.allowedPlaylists.id, id), eq(schema.allowedPlaylists.childId, user.id)) }).then(item => item && ({
        id: item.id, externalId: item.playlistId, fetchPlaylistId: item.playlistId, title: item.playlistTitle,
        thumbnail: item.playlistThumbnail, isAvailable: item.isAvailable, contentRule: item.contentRule, tags: item.tags,
      }))
  if (!source) throw new HTTPException(404, { message: `${kind} not found` })
  const curated = source.externalId.startsWith('pl:')
  const pageSize = curated ? 200 : 50
  const presentedSource = {
    curated,
    id: source.id,
    ...(kind === 'channel' ? { channelId: source.externalId } : { playlistId: source.externalId }),
    title: source.title, thumbnail: source.thumbnail, isAvailable: source.isAvailable,
    contentRule: source.contentRule, tags: source.tags,
  }
  if (source.externalId.startsWith('pl:') || (!refresh && !pageToken)) {
    const videos = (kind === 'channel'
      ? await db.query.channelVideos.findMany({ where: and(eq(schema.channelVideos.channelId, source.externalId), sql`instr(lower(${schema.channelVideos.videoTitle} || ' ' || coalesce(${schema.channelVideos.channelTitle}, '')), lower(${query})) > 0`, sql`(${schema.channelVideos.duration} IS NULL OR ${schema.channelVideos.duration} > 180)`), orderBy: (table, { asc }) => [asc(table.position), asc(table.videoId)], limit: 51, offset: page * 50 })
      : await db.query.playlistVideos.findMany({ where: and(eq(schema.playlistVideos.playlistId, source.externalId), sql`instr(lower(${schema.playlistVideos.videoTitle} || ' ' || coalesce(${schema.playlistVideos.channelTitle}, '')), lower(${query})) > 0`, sql`(${schema.playlistVideos.duration} IS NULL OR ${schema.playlistVideos.duration} > 180)`), orderBy: (table, { asc }) => [asc(table.position), asc(table.videoId)], limit: pageSize + 1, offset: page * pageSize })) as Array<typeof schema.channelVideos.$inferSelect | typeof schema.playlistVideos.$inferSelect>
    const nextPage = videos.length > pageSize ? page + 1 : null
    videos.splice(pageSize)
    const favoriteVideoIds = await favoriteVideoIdsFor(db, user.id!, videos)
    const [presentedVideos, viewing] = await Promise.all([
      videosWithResolvedRules(db, user.id!, videos),
      childViewingStatus(db, user.id!, instant),
    ])
    const progress = curated ? await db.query.playbackProgress.findMany({ where: eq(schema.playbackProgress.childId, user.id) }) : []
    const unlockedVideoIds = await unlockedVideoIdsFor(c.env.DB, user.id!, presentedVideos)
    return c.json({ [kind]: presentedSource, videos: presentedVideos.map(video => ({ ...video, ...(curated ? { positionSeconds: progress.find(p => p.videoId === video.videoId)?.positionSeconds } : {}) })), favoriteVideoIds, unlockedVideoIds, nextPage, cached: true, ...viewing })
  }
  const result = await fetchPlaylistVideosPage(source.fetchPlaylistId, c.env.YOUTUBE_API_KEY, pageToken)
  const { videos, rejectedVideoIds } = excludeUnsupportedVideos(result.videos)
  await writeContentCache(c.env.DB, { kind, externalId: source.externalId }, videos, {
    replace: kind === 'playlist' && !pageToken, rejectedVideoIds, positionOffset: page * 50,
    nextPageToken: result.nextPageToken, instant,
  })
  const favoriteVideoIds = await favoriteVideoIdsFor(db, user.id!, videos)
  const [presentedVideos, viewing] = await Promise.all([
    videosWithResolvedRules(db, user.id!, presentVideos(videos)),
    childViewingStatus(db, user.id!, instant),
  ])
  return c.json({ [kind]: { ...presentedSource, isAvailable: true }, videos: presentedVideos, favoriteVideoIds, nextPageToken: result.nextPageToken, ...viewing })
}

function presentVideos(videos: Awaited<ReturnType<typeof fetchPlaylistVideosPage>>['videos']) {
  return videos.map(video => ({ videoId: video.videoId, videoTitle: video.title, videoThumbnail: video.thumbnail, duration: video.duration, channelTitle: video.channelTitle, publishedAt: video.publishedAt }))
}

function numericId(value: string | undefined) {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new HTTPException(400, { message: 'Invalid id' })
  return id
}
