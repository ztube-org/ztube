import { database } from '../database/client.ts'
import type { Hono, Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import * as v from 'valibot'
import { requireRole, type AppEnv } from './identity.ts'
import { approvedVideoMetadata, resolveApprovedVideos } from './catalog.ts'
import { ensureTimeSettings } from './usage.ts'
import { cartoonPoolId, poolBalance, poolStatuses } from './time-pools.ts'
import { endActivePlayback } from './playback-ledger.ts'
import { epochSeconds, viewingDayAt } from '../utils/viewing-day.ts'
import type { ApprovedVideo, EpisodeClaimStatus } from '../../src/domain.ts'

const videoIdInput = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64))

export async function episodeClaimStatus(binding: D1Database, childId: number, viewingDay: string): Promise<EpisodeClaimStatus> {
  const [settings, claims, grants] = await Promise.all([
    binding.prepare('SELECT daily_limit AS dailyLimit FROM child_episode_settings WHERE child_id = ?').bind(childId).first<{ dailyLimit: number }>(),
    binding.prepare('SELECT video_id AS videoId FROM episode_claims WHERE child_id = ? AND viewing_day = ? ORDER BY claimed_at, video_id').bind(childId, viewingDay).all<{ videoId: string }>(),
    binding.prepare('SELECT COUNT(*) AS credits FROM episode_credit_grants WHERE child_id = ? AND viewing_day = ?').bind(childId, viewingDay).first<{ credits: number }>(),
  ])
  const dailyLimit = settings?.dailyLimit ?? 1
  const bonusCredits = grants?.credits ?? 0
  const totalCredits = dailyLimit + bonusCredits
  return { viewingDay, dailyLimit, bonusCredits, totalCredits, remaining: Math.max(0, totalCredits - claims.results.length), claimedVideoIds: claims.results.map(row => row.videoId) }
}

export async function hasEpisodeUnlock(binding: D1Database, childId: number, videoId: string) {
  return Boolean(await binding.prepare('SELECT 1 FROM episode_unlocks WHERE child_id = ? AND video_id = ?').bind(childId, videoId).first())
}

export async function pruneEpisodeClaims(binding: D1Database, instant: Date) {
  const db = database(binding)
  const children = await binding.prepare('SELECT child_id AS childId FROM episode_claims UNION SELECT child_id AS childId FROM episode_credit_grants').all<{ childId: number }>()
  for (const { childId } of children.results) {
    const settings = await ensureTimeSettings(db, childId)
    const day = viewingDayAt(instant, settings.timeZone, settings).localDate
    await binding.batch([
      binding.prepare('DELETE FROM episode_claims WHERE child_id = ? AND viewing_day < ?').bind(childId, day),
      binding.prepare('DELETE FROM episode_credit_grants WHERE child_id = ? AND viewing_day < ?').bind(childId, day),
    ])
  }
}

export function registerEpisodeClaimRoutes(app: Hono<AppEnv>, now: () => Date) {
  async function adminChild(c: Context<AppEnv>) {
    requireRole(c.get('user'), 'admin')
    const childId = v.parse(v.pipe(v.number(), v.integer(), v.minValue(1)), Number(c.req.param('id')))
    if (!await c.env.DB.prepare('SELECT 1 FROM children WHERE id = ?').bind(childId).first()) throw new HTTPException(404, { message: 'Child not found' })
    return childId
  }

  app.get('/api/admin/children/:id/unlock-credits', async c => {
    c.header('Cache-Control', 'no-store')
    const childId = await adminChild(c)
    const settings = await ensureTimeSettings(database(c.env.DB), childId)
    return c.json(await episodeClaimStatus(c.env.DB, childId, viewingDayAt(now(), settings.timeZone, settings).localDate))
  })

  app.post('/api/admin/children/:id/unlock-credits', async c => {
    c.header('Cache-Control', 'no-store')
    const childId = await adminChild(c)
    const input = v.parse(v.object({ requestId: v.pipe(v.string(), v.uuid()), viewingDay: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)) }), await c.req.json())
    const settings = await ensureTimeSettings(database(c.env.DB), childId)
    const instant = now()
    const day = viewingDayAt(instant, settings.timeZone, settings).localDate
    if (input.viewingDay !== day) throw new HTTPException(409, { message: 'A new viewing day has started. Refresh the credits before granting again.' })
    await c.env.DB.prepare(`INSERT INTO episode_credit_grants (child_id, request_id, viewing_day, granted_by, granted_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(child_id, request_id) DO NOTHING`)
      .bind(childId, input.requestId, day, c.get('user').id, epochSeconds(instant)).run()
    return c.json(await episodeClaimStatus(c.env.DB, childId, day))
  })

  app.get('/api/admin/children/:id/cartoon-pool', async c => {
    const childId = await adminChild(c)
    const [settings, playlists] = await Promise.all([
      c.env.DB.prepare('SELECT daily_limit AS dailyLimit FROM child_episode_settings WHERE child_id = ?').bind(childId).first<{ dailyLimit: number }>(),
      c.env.DB.prepare('SELECT id FROM allowed_playlists WHERE child_id = ? AND cartoon_pool = 1').bind(childId).all<{ id: number }>(),
    ])
    const time = await ensureTimeSettings(database(c.env.DB), childId)
    return c.json({ dailyLimit: settings?.dailyLimit ?? 1, timePoolId: await cartoonPoolId(database(c.env.DB), childId), cartoonAllowanceMinutes: time.cartoonAllowanceMinutes, playlistIds: playlists.results.map(row => row.id) })
  })

  app.put('/api/admin/children/:id/cartoon-pool', async c => {
    const childId = await adminChild(c)
    const input = v.parse(v.object({ dailyLimit: v.picklist([1, 2]), timePoolId: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(64))), cartoonAllowanceMinutes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1440))), playlistIds: v.pipe(v.array(v.pipe(v.number(), v.integer(), v.minValue(1))), v.maxLength(500)) }), await c.req.json())
    const ids = [...new Set(input.playlistIds)]
    const selected = JSON.stringify(ids)
    const owned = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM allowed_playlists WHERE child_id = ? AND id IN (SELECT value FROM json_each(?))').bind(childId, selected).first<{ count: number }>()
    if (owned?.count !== ids.length) throw new HTTPException(400, { message: 'Choose this Child’s approved Playlists' })
    const time = await ensureTimeSettings(database(c.env.DB), childId)
    const db = database(c.env.DB)
    const selectedPoolId = input.timePoolId ?? await cartoonPoolId(db, childId)
    await poolBalance(db, childId, selectedPoolId, now())
    const cartoonMinutes = input.cartoonAllowanceMinutes ?? time.cartoonAllowanceMinutes
    // Settle against the old allowance before changing it. The next playback
    // authorization observes the new balance, including a reduction to zero.
    if (cartoonMinutes !== time.cartoonAllowanceMinutes) await endActivePlayback(c.env.DB, childId, now(), { settings: time, buckets: ['cartoon'] })
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO time_pool_bindings (child_id, kind, content_id, pool_id) VALUES (?, 'cartoon', '*', ?) ON CONFLICT(child_id, kind, content_id) DO UPDATE SET pool_id = excluded.pool_id").bind(childId, selectedPoolId),
      c.env.DB.prepare('UPDATE child_time_settings SET cartoon_allowance_minutes = ?, updated_at = ? WHERE child_id = ?').bind(cartoonMinutes, epochSeconds(now()), childId),
      c.env.DB.prepare('INSERT INTO child_episode_settings (child_id, daily_limit) VALUES (?, ?) ON CONFLICT(child_id) DO UPDATE SET daily_limit = excluded.daily_limit').bind(childId, input.dailyLimit),
      c.env.DB.prepare('UPDATE allowed_playlists SET cartoon_pool = CASE WHEN id IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END WHERE child_id = ?').bind(selected, childId),
    ])
    return c.json({ dailyLimit: input.dailyLimit, timePoolId: selectedPoolId, cartoonAllowanceMinutes: cartoonMinutes, playlistIds: ids })
  })

  app.get('/api/child/cartoon-pool', async c => {
    c.header('Cache-Control', 'no-store')
    const childId = c.get('user').id
    const db = database(c.env.DB)
    const settings = await ensureTimeSettings(db, childId)
    const day = viewingDayAt(now(), settings.timeZone, settings).localDate
    const status = await episodeClaimStatus(c.env.DB, childId, day)
    const cartoonTime = await poolBalance(db, childId, await cartoonPoolId(db, childId), now())
    const timePools = (await poolStatuses(db, childId, now())).filter(pool => pool.requiresClaim || pool.id === cartoonTime.id)
    const page = v.parse(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10000)), Number(c.req.query('page') ?? 0))
    const unlockedOnly = c.req.query('unlocked') === '1'
    const jellyfinOnly = c.req.query('source') === 'jellyfin'
    const query = (c.req.query('q') ?? '').trim().slice(0, 200).toLowerCase()
    const rows = await c.env.DB.prepare(`WITH candidates AS (
      SELECT pv.video_id, pv.video_title, a.playlist_title AS source_title FROM allowed_playlists a JOIN playlist_videos pv ON pv.playlist_id = a.playlist_id WHERE a.child_id = ? AND a.is_available = 1
      UNION ALL SELECT cv.video_id, cv.video_title, a.channel_title FROM allowed_channels a JOIN channel_videos cv ON cv.channel_id = a.channel_id WHERE a.child_id = ? AND a.is_available = 1
      UNION ALL SELECT video_id, video_title, coalesce(channel_title, '') FROM allowed_videos WHERE child_id = ? AND is_available = 1
    ) SELECT DISTINCT video_id AS videoId FROM candidates WHERE instr(lower(video_title || ' ' || source_title), ?) > 0
      AND (? = 0 OR video_id LIKE 'jf:%')
      AND (? = 0 OR video_id IN (SELECT video_id FROM episode_unlocks WHERE child_id = ?)) ORDER BY video_id LIMIT 49 OFFSET ?`)
      .bind(childId, childId, childId, query, jellyfinOnly ? 1 : 0, unlockedOnly ? 1 : 0, childId, page * 48).all<{ videoId: string }>()
    const selectedIds = rows.results.slice(0, 48).map(row => row.videoId)
    const unlocked = selectedIds.length ? await c.env.DB.prepare('SELECT video_id AS videoId FROM episode_unlocks WHERE child_id = ? AND video_id IN (SELECT value FROM json_each(?))').bind(childId, JSON.stringify(selectedIds)).all<{ videoId: string }>() : { results: [] }
    const unlockedVideoIds = unlocked.results.map(row => row.videoId)
    const resolved = await resolveApprovedVideos(db, childId, [...selectedIds, ...status.claimedVideoIds])
    const videos = (ids: string[]): ApprovedVideo[] => ids.flatMap(id => {
      const video = resolved.get(id)
      return video?.supported && video.requiresClaim ? [{ ...video, publishedAt: video.publishedAt?.toISOString() ?? null }] : []
    })
    return c.json({ ...status, unlockedVideoIds, timePools, cartoonTime, videos: videos(selectedIds), claimedVideos: videos(status.claimedVideoIds), nextPage: rows.results.length > 48 ? page + 1 : null })
  })

  app.post('/api/child/episode-claims', async c => {
    c.header('Cache-Control', 'no-store')
    const childId = c.get('user').id
    const input = v.parse(v.object({ videoId: videoIdInput, confirmed: v.literal(true), viewingDay: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/)) }), await c.req.json())
    const db = database(c.env.DB)
    const settings = await ensureTimeSettings(db, childId)
    const video = await approvedVideoMetadata(db, childId, input.videoId)
    if (!video || !video.requiresClaim || video.timePoolConflict) throw new HTTPException(403, { message: 'Episode is not in your Cartoon Pool' })
    const instant = now()
    const day = viewingDayAt(instant, settings.timeZone, settings).localDate
    if (await hasEpisodeUnlock(c.env.DB, childId, input.videoId)) return c.json(await episodeClaimStatus(c.env.DB, childId, day))
    if (input.viewingDay !== day) throw new HTTPException(409, { message: 'A new viewing day has started. Reload and confirm your choice again.' })
    // Count and insert in one statement: simultaneous claims from different
    // devices cannot spend the same last slot. Repeating a claim is idempotent.
    await c.env.DB.prepare(`INSERT INTO episode_claims (child_id, viewing_day, video_id, claimed_at)
      SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM episode_unlocks WHERE child_id = ? AND video_id = ?) AND
        (SELECT COUNT(*) FROM episode_claims WHERE child_id = ? AND viewing_day = ?) <
        COALESCE((SELECT daily_limit FROM child_episode_settings WHERE child_id = ?), 1) +
        (SELECT COUNT(*) FROM episode_credit_grants WHERE child_id = ? AND viewing_day = ?)
      ON CONFLICT(child_id, viewing_day, video_id) DO NOTHING`)
      .bind(childId, day, input.videoId, epochSeconds(instant), childId, input.videoId, childId, day, childId, childId, day).run()
    if (!await hasEpisodeUnlock(c.env.DB, childId, input.videoId)) throw new HTTPException(409, { message: 'Today’s unlock credits are used up. Watch an unlocked episode or come back tomorrow.' })
    return c.json(await episodeClaimStatus(c.env.DB, childId, day))
  })
}
