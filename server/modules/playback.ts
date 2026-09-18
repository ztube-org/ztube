import { prepareJellyfinRemux, cleanupRemux, type RemuxSession } from './jellyfin-remux.ts'
import { playbackReads } from '../database/playback-reads.ts'
import { database } from '../database/client.ts'
import { getProvider } from './provider-config.ts'
import { resolveMediaUrl } from './webdav-client.ts'
import type { Context, Hono } from 'hono'
import { getJellyfinServer, prepareJellyfinMedia, jellyfinDirectUrl, directMp4Source } from './jellyfin-client.ts'
import { HTTPException } from 'hono/http-exception'
import { and, eq, isNull } from 'drizzle-orm'
import * as v from 'valibot'
import * as schema from '../database/schema.ts'
import type { AppEnv } from './identity.ts'
import { approvedVideoMetadata, resolveApprovedVideos } from './catalog.ts'
import { ensureTimeSettings, dailyUsage, effectiveLimits, watchTimeStatus } from './usage.ts'
import { settlementStatements, endSessionStatement, takeOverPlayback } from './playback-ledger.ts'
import { epochSeconds, viewingDayAt, viewingDaySegments } from '../utils/viewing-day.ts'
import { playbackPolicyAt, playbackPolicyMessage } from '../utils/playback-policy.ts'
import { poolBalance, poolStatuses } from './time-pools.ts'
import { episodeClaimStatus, hasEpisodeUnlock } from './episode-claims.ts'

const HEARTBEAT_INTERVAL_SECONDS = 15
const PLAYBACK_LEASE_SECONDS = 60
const playbackState = v.picklist(['playing', 'paused', 'buffering', 'ended'])
const positiveInteger = v.pipe(v.number(), v.integer(), v.minValue(1))
const videoIdInput = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(64))

export function registerPlaybackRoutes(app: Hono<AppEnv>, now: () => Date) {
  app.post('/api/child/playback-authorizations', async c => {
    const user = c.get('user')
    const input = v.parse(v.object({ videoId: videoIdInput }), await c.req.json())
    const db = database(c.env.DB)

    const video = (await resolveApprovedVideos(db, user.id, [input.videoId])).get(input.videoId)
    if (!video) throw new HTTPException(403, { message: 'Video is not Approved Content' })
    if (!video.supported) throw new HTTPException(403, { message: 'Videos of 3 minutes or less are not supported' })
    const settings = await ensureTimeSettings(db, user.id)
    const instant = now()
    const day = viewingDayAt(instant, settings.timeZone, settings)
    const source = video.source
    const usageBucket = video.usageBucket
    if (video.timePoolConflict) throw new HTTPException(409, { message: 'This video has conflicting time pool bindings. Ask an Admin to choose its pool.' })
    const pool = await poolBalance(db, user.id, video.timePoolId, instant, settings)
    const requiresClaim = video.requiresClaim
    if (requiresClaim && !await hasEpisodeUnlock(c.env.DB, user.id, input.videoId)) {
      const progress = await db.query.playbackProgress.findFirst({ where: and(eq(schema.playbackProgress.childId, user.id), eq(schema.playbackProgress.videoId, input.videoId)) })
      return c.json({ code: 'episode-claim-required', message: 'Confirm your episode claim before watching.', claim: {
        ...await episodeClaimStatus(c.env.DB, user.id, day.localDate), videoTitle: video.videoTitle, positionSeconds: progress?.positionSeconds ?? 0, duration: video.duration,
      } }, 409)
    }
    const usage = await dailyUsage(db, user.id!, day.localDate, instant)
    const policy = playbackPolicyAt(instant, settings, usage)
    if (policy.reason) throw new HTTPException(403, { message: playbackPolicyMessage(policy.reason) })
    const remainingSeconds = pool.remainingSeconds
    if (remainingSeconds === 0) throw new HTTPException(403, { message: `Today’s ${pool.name} time is used up` })
    const sessionId = crypto.randomUUID()
    const authorizedAt = instant
    const leaseSeconds = PLAYBACK_LEASE_SECONDS
    const leaseExpiresAt = new Date((epochSeconds(authorizedAt) + leaseSeconds) * 1000)
    const [progress, favorite] = await Promise.all([
      db.query.playbackProgress.findFirst({ where: and(eq(schema.playbackProgress.childId, user.id!), eq(schema.playbackProgress.videoId, input.videoId)) }),
      db.query.favoriteVideos.findFirst({ where: and(eq(schema.favoriteVideos.childId, user.id!), eq(schema.favoriteVideos.videoId, input.videoId)) }),
    ])
    const activated = await takeOverPlayback(c.env.DB, { childId: user.id, sessionId, videoId: input.videoId, videoTitle: video.videoTitle, channelTitle: video.channelTitle ?? null, bucket: usageBucket, poolId: pool.id, instant, settings, leaseSeconds })
    const settledUsage = await dailyUsage(db, user.id, day.localDate, instant)
    const settledPolicy = playbackPolicyAt(instant, settings, settledUsage)
    if (!activated) {
      if (settledPolicy.reason) throw new HTTPException(403, { message: playbackPolicyMessage(settledPolicy.reason) })
      throw new HTTPException(403, { message: `Today’s ${pool.name} time is used up` })
    }
    const settledRemaining = (await poolBalance(db, user.id, pool.id, instant, settings)).remainingSeconds
    return c.json({
      authorization: {
        videoId: input.videoId,
        source,
        usageBucket,
        timePoolId: pool.id, timePoolName: pool.name,
        authorizedAt: authorizedAt.toISOString(),
        sessionId,
        playerKind: /^(ol|jf):/.test(input.videoId) ? 'native' : 'youtube',
        remainingSeconds: settledRemaining,
        heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
        resumeAt: progress?.positionSeconds ?? 0,
        favorite: Boolean(favorite),
        videoTitle: video.videoTitle,
        videoDescription: video.videoDescription ?? '',
        channelTitle: video.channelTitle ?? '',
      },
    })
  })

  async function activeNativeSession(c: Context<AppEnv>) {
    const childId = c.get('user').id
    const session = await playbackReads(database(c.env.DB)).session().execute({ id: c.req.param('id') ?? '', childId })
    if (!session || session.endedAt || session.leaseExpiresAt <= now() || !session.videoId || !/^(ol|jf):/.test(session.videoId)) throw new HTTPException(403, { message: 'Playback Authorization is no longer active' })
    return session
  }

  async function validateNative(c: Context<AppEnv>) {
    const db = database(c.env.DB)
    const childId = c.get('user').id
    const instant = now()
    const session = await activeNativeSession(c)
    const video = await approvedVideoMetadata(db, childId, session.videoId!)
    if (!video || video.timePoolConflict || video.timePoolId !== (session.timePoolId ?? `pool:${childId}:${session.usageBucket}`)) throw new HTTPException(403, { message: 'Video is no longer approved' })
    const settings = await ensureTimeSettings(db, childId)
    const day = viewingDayAt(instant, settings.timeZone, settings)
    if (video.requiresClaim && !await hasEpisodeUnlock(c.env.DB, childId, session.videoId!)) throw new HTTPException(403, { message: 'Unlock this episode before watching.' })
    const usage = await dailyUsage(db, childId, day.localDate, instant)
    // Include the unacknowledged active interval without charging it twice or
    // granting a new lease. Heartbeats remain the sole accounting transition.
    const pending = session.lastState === 'playing' ? viewingDaySegments(session.lastAcknowledgedAt, instant, settings.timeZone, settings)
      .filter(segment => segment.viewingDay === day.localDate).reduce((total, segment) => total + segment.endEpoch - segment.startEpoch, 0) : 0
    const pool = await poolBalance(db, childId, video.timePoolId, instant, settings)
    usage.breakCycleSeconds += pending
    if (playbackPolicyAt(instant, settings, usage).blocked || (settings.breakAfterMinutes > 0 && usage.breakCycleSeconds >= settings.breakAfterMinutes * 60)
      || (pending >= pool.remainingSeconds)) throw new HTTPException(403, { message: 'Viewing time is currently unavailable' })
    return session
  }

  app.get('/api/child/playback-authorizations/:id/media', async c => {
    c.header('Cache-Control', 'no-store')
    const db = database(c.env.DB)
    // Cheap ownership/lease gate before upstream I/O; full policy is checked
    // once, after resolving the URL and immediately before returning it.
    const session = await activeNativeSession(c)
    if (session.videoId!.startsWith('jf:')) {
      const media = await db.query.jellyfinMedia.findFirst({ where: eq(schema.jellyfinMedia.videoId, session.videoId!) })
      if (!media) throw new HTTPException(404, { message: 'Jellyfin episode not found' })
      const server = await getJellyfinServer(c.env, media.serverId)
      const source = await prepareJellyfinMedia(c.env, server, media.itemId)
      let remux: RemuxSession | undefined
      let published = false
      try {
        let result: { url: string; transport?: 'hls'; hlsEngine?: 'native' | 'mse'; cleanupId?: string }
        if (directMp4Source([source])) result = { url: await jellyfinDirectUrl(c.env, server, media.itemId, source.Id!) }
        else {
          const codecs = (c.req.query('codecs') ?? '').slice(0, 100).split(',')
          const id = crypto.randomUUID()
          const nativePlayback = c.req.query('nativeCodecs') === undefined ? undefined : {
            codecs: (c.req.query('nativeCodecs') ?? '').slice(0, 100).split(','), preferred: c.req.query('preferNativeHls') === '1',
          }
          const prepared = await prepareJellyfinRemux(c.env, server, media.itemId, source, codecs, `ztube-${id}`, nativePlayback)
          remux = { id, serverId: server.id, deviceId: prepared.deviceId, playSessionId: prepared.playSessionId }
          await c.env.DB.prepare('INSERT INTO jellyfin_remux_sessions (id, authorization_id, server_id, play_session_id, device_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .bind(id, session.id, server.id, remux.playSessionId, remux.deviceId, epochSeconds(now())).run()
          result = { url: prepared.url, transport: 'hls', ...(nativePlayback ? { hlsEngine: prepared.hlsEngine } : {}), cleanupId: id }
        }
        await validateNative(c)
        const current = await getJellyfinServer(c.env, server.id)
        if (current.revision !== server.revision) throw new HTTPException(409, { message: 'Jellyfin connection changed. Restart playback.' })
        published = true
        return c.json(result)
      } finally {
        if (remux && !published) await cleanupRemux(c.env, remux)
      }
    }
    await validateNative(c)
    const media = await db.query.providerMedia.findFirst({ where: eq(schema.providerMedia.videoId, session.videoId!) })
    if (!media) throw new HTTPException(404, { message: 'Media source not found' })
    const provider = await getProvider(c.env, media.providerId)
    const url = await resolveMediaUrl(c.env, provider, media.path)
    await validateNative(c)
    const current = await getProvider(c.env, provider.id)
    if (!current.enabled || current.revision !== provider.revision) throw new HTTPException(409, { message: 'Provider changed. Restart playback.' })
    return c.json({ url })
  })

  app.post('/api/child/playback-authorizations/:id/media/:mediaId/stop', async c => {
    c.header('Cache-Control', 'no-store')
    // Cleanup is allowed after expiry/revocation, but only for this Child's
    // exact generation. Never accept upstream session IDs from the browser.
    const row = await c.env.DB.prepare(`SELECT r.id, r.server_id AS serverId, r.play_session_id AS playSessionId, r.device_id AS deviceId
      FROM jellyfin_remux_sessions r JOIN playback_sessions p ON p.id = r.authorization_id
      WHERE r.id = ? AND p.id = ? AND p.child_id = ?`)
      .bind(c.req.param('mediaId'), c.req.param('id'), c.get('user').id).first<RemuxSession>()
    if (row) await cleanupRemux(c.env, row)
    return c.json({ success: true })
  })

  app.get('/api/child/watch-time', async c => {
    const user = c.get('user')
    const db = database(c.env.DB)
    const settings = await ensureTimeSettings(db, user.id!)
    const day = viewingDayAt(now(), settings.timeZone, settings)
    const instant = now()
    const usage = await dailyUsage(db, user.id!, day.localDate, instant)
    return c.json({ pools: await poolStatuses(db, user.id, instant), viewingDay: day.localDate, ...watchTimeStatus(...effectiveLimits(day.allowanceMinutes, settings.safetyCapMinutes, usage), usage, settings.cartoonAllowanceMinutes), policy: playbackPolicyAt(instant, settings, usage) })
  })

  app.post('/api/child/playback-authorizations/:id/heartbeats', async c => {
    const user = c.get('user')
    const input = v.parse(v.object({ sequence: positiveInteger, state: playbackState, positionSeconds: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(86400)), 0) }), await c.req.json())
    const db = database(c.env.DB)
    const session = await playbackReads(db).session().execute({ id: c.req.param('id') ?? '', childId: user.id })
    if (!session) throw new HTTPException(404, { message: 'Playback Authorization not found' })
    const settings = await ensureTimeSettings(db, user.id!)
    const acknowledgedAt = now()
    const day = viewingDayAt(acknowledgedAt, settings.timeZone, settings)
    const sessionPoolId = session.timePoolId ?? `pool:${user.id}:${session.usageBucket}`
    const poolBeforeHeartbeat = await poolBalance(db, user.id, sessionPoolId, acknowledgedAt, settings)
    if (input.sequence <= session.lastSequence || session.endedAt) {
      return c.json({ accepted: false, sequence: session.lastSequence, remainingSeconds: poolBeforeHeartbeat.remainingSeconds, authorized: false })
    }
    const usageBeforeHeartbeat = await dailyUsage(db, user.id!, day.localDate, acknowledgedAt)
    const policyBeforeHeartbeat = playbackPolicyAt(acknowledgedAt, settings, usageBeforeHeartbeat)
    const metadata = session.videoId ? await approvedVideoMetadata(db, user.id, session.videoId) : null
    const requiresClaim = metadata?.requiresClaim ?? false
    const claimAllowed = !requiresClaim || (session.videoId && await hasEpisodeUnlock(c.env.DB, user.id, session.videoId))
    if (!metadata || metadata.timePoolConflict || metadata.timePoolId !== sessionPoolId || !claimAllowed) {
      await c.env.DB.batch([...settlementStatements(c.env.DB, session, settings, acknowledgedAt, input.sequence), endSessionStatement(c.env.DB, session.id, acknowledgedAt)])
      const settled = await poolBalance(db, user.id, sessionPoolId, acknowledgedAt, settings)
      return c.json({ accepted: false, sequence: session.lastSequence, remainingSeconds: settled.remainingSeconds, authorized: false })
    }
    if (policyBeforeHeartbeat.reason) {
      await c.env.DB.batch([...settlementStatements(c.env.DB, session, settings, acknowledgedAt, input.sequence), endSessionStatement(c.env.DB, session.id, acknowledgedAt)])
      return c.json({ accepted: false, sequence: session.lastSequence, remainingSeconds: poolBeforeHeartbeat.remainingSeconds, authorized: false, policy: policyBeforeHeartbeat })
    }
    const acknowledgedEpoch = epochSeconds(acknowledgedAt)
    const nextLeaseEpoch = acknowledgedEpoch + PLAYBACK_LEASE_SECONDS
    const chargeStatements = settlementStatements(c.env.DB, session, settings, acknowledgedAt, input.sequence)
    const results = await c.env.DB.batch([
      ...chargeStatements,
      c.env.DB.prepare(`
        UPDATE playback_sessions SET
          viewing_day = ?, last_sequence = ?, last_acknowledged_at = ?,
          last_state = CASE WHEN ? >= lease_expires_at OR ? = 'ended' THEN 'ended' ELSE ? END,
          lease_expires_at = CASE WHEN ? >= lease_expires_at OR ? = 'ended' THEN lease_expires_at ELSE ? END,
          ended_at = CASE WHEN ? >= lease_expires_at OR ? = 'ended' THEN ? ELSE NULL END,
          video_id = CASE WHEN ? >= lease_expires_at OR ? = 'ended' THEN NULL ELSE video_id END
        WHERE id = ? AND child_id = ? AND ended_at IS NULL AND last_sequence < ?
      `).bind(day.localDate, input.sequence, acknowledgedEpoch, acknowledgedEpoch, input.state, input.state,
        acknowledgedEpoch, input.state, nextLeaseEpoch, acknowledgedEpoch, input.state, acknowledgedEpoch,
        acknowledgedEpoch, input.state,
        session.id, user.id!, input.sequence),
    ])
    const accepted = Number(results[chargeStatements.length].meta.changes ?? 0) > 0
    const [updatedSession, usage] = await Promise.all([
      playbackReads(db).session().execute({ id: session.id, childId: user.id }),
      dailyUsage(db, user.id!, day.localDate),
    ])
    const settledPool = await poolBalance(db, user.id, sessionPoolId, acknowledgedAt, settings)
    const policy = playbackPolicyAt(acknowledgedAt, settings, usage)
    const authorized = accepted && updatedSession?.endedAt === null && !settledPool.locked && !policy.blocked
    if (accepted && !authorized && updatedSession?.endedAt === null) {
      await db.update(schema.playbackSessions).set({ lastState: 'ended', endedAt: acknowledgedAt, videoId: null }).where(and(eq(schema.playbackSessions.id, session.id), isNull(schema.playbackSessions.endedAt)))
    }
    if (accepted && session.videoId) {
      const duration = metadata?.duration ?? 0
      const completed = input.state === 'ended' || (duration > 0 && (input.positionSeconds >= duration * 0.9 || duration - input.positionSeconds <= 30))
      if (completed) {
        await db.delete(schema.playbackProgress).where(and(eq(schema.playbackProgress.childId, user.id!), eq(schema.playbackProgress.videoId, session.videoId)))
      } else if (metadata && input.positionSeconds >= 30 && duration > 0) {
        await db.insert(schema.playbackProgress).values({
          childId: user.id!, videoId: session.videoId, positionSeconds: input.positionSeconds, duration,
          videoTitle: metadata.videoTitle, videoThumbnail: metadata.videoThumbnail, channelTitle: metadata.channelTitle,
          publishedAt: metadata.publishedAt, updatedAt: acknowledgedAt,
        }).onConflictDoUpdate({
          target: [schema.playbackProgress.childId, schema.playbackProgress.videoId],
          set: { positionSeconds: input.positionSeconds, duration, videoTitle: metadata.videoTitle, videoThumbnail: metadata.videoThumbnail, channelTitle: metadata.channelTitle, publishedAt: metadata.publishedAt, updatedAt: acknowledgedAt },
        })
        await c.env.DB.prepare('DELETE FROM playback_progress WHERE child_id = ? AND id NOT IN (SELECT id FROM playback_progress WHERE child_id = ? ORDER BY updated_at DESC LIMIT 10)').bind(user.id!, user.id!).run()
      }
    }
    return c.json({
      accepted,
      sequence: updatedSession?.lastSequence ?? session.lastSequence,
      remainingSeconds: settledPool.remainingSeconds,
      authorized,
      leaseExpiresAt: authorized ? updatedSession?.leaseExpiresAt.toISOString() : null,
    })
  })

}
