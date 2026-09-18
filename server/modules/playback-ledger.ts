import { database } from '../database/client.ts'
import { and, eq, isNull } from 'drizzle-orm'
import * as schema from '../database/schema.ts'
import { epochSeconds, viewingDayAt, viewingDaySegments } from '../utils/viewing-day.ts'
import { ensureTimeSettings } from './usage.ts'
import { localMinuteAt } from '../utils/playback-policy.ts'
import type { UsageBucket } from '../../src/domain.ts'

type Session = typeof schema.playbackSessions.$inferSelect
type Settings = typeof schema.childTimeSettings.$inferSelect

// Always execute these statements in the SAME batch as the session transition.
// The ledger reads the current acknowledgement/state inside that transaction,
// so a racing heartbeat or takeover cannot charge the same interval twice.
export function settlementStatements(binding: D1Database, session: Session, settings: Settings, instant: Date, sequence?: number) {
  const end = new Date(Math.min(instant.getTime(), session.leaseExpiresAt.getTime()))
  const segments = viewingDaySegments(session.lastAcknowledgedAt, end, settings.timeZone, settings)
  const poolId = session.timePoolId ?? `pool:${session.childId}:${session.usageBucket}`
  const epoch = epochSeconds(instant)
  const statements: D1PreparedStatement[] = []
  for (const segment of segments) {
    const day = viewingDayAt(new Date(segment.startEpoch * 1000), settings.timeZone, settings)
    const allowanceColumn = day.isWeekend ? 'weekend_minutes' : 'weekday_minutes'
    const limit = `CASE WHEN u.unlocked = 1 THEN 86400 ELSE (t.${allowanceColumn} + u.extension_minutes) * 60 END`
    statements.push(binding.prepare('INSERT INTO daily_usage_summaries (child_id, viewing_day) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(session.childId, segment.viewingDay))
    statements.push(binding.prepare('INSERT INTO time_pool_usage (child_id, pool_id, viewing_day) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(session.childId, poolId, segment.viewingDay))
    const charge = `
      WITH charge(value) AS (
        SELECT MIN(
          MAX(0, MIN(?, p.lease_expires_at) - MAX(?, p.last_acknowledged_at)),
          MAX(0, (${limit}) - u.used_seconds)
        ) FROM playback_sessions p JOIN time_pool_usage u ON u.child_id = p.child_id AND u.pool_id = COALESCE(p.time_pool_id, 'pool:' || p.child_id || ':' || p.usage_bucket) AND u.viewing_day = ? JOIN time_pools t ON t.id = u.pool_id
        WHERE p.id = ? AND p.ended_at IS NULL AND p.last_state = 'playing'
          AND (? IS NULL OR p.last_sequence < ?)
      )`
    const chargeArgs = [segment.endEpoch, segment.startEpoch, segment.viewingDay, session.id, sequence ?? null, sequence ?? null]
    // Record the same capped charge BEFORE updating the daily balance, within
    // the same transaction. Both projections read identical session state.
    statements.push(binding.prepare(`${charge}
      UPDATE viewing_events SET
        started_at = COALESCE(started_at, MAX(?, (SELECT last_acknowledged_at FROM playback_sessions WHERE id = ?))),
        last_watched_at = MAX(?, (SELECT last_acknowledged_at FROM playback_sessions WHERE id = ?)) + (SELECT value FROM charge),
        watched_seconds = watched_seconds + (SELECT value FROM charge)
      WHERE session_id = ? AND (SELECT value FROM charge) > 0
    `).bind(...chargeArgs, segment.startEpoch, session.id, segment.startEpoch, session.id, session.id))
    statements.push(binding.prepare(`${charge}
      UPDATE daily_usage_summaries SET
        break_until = CASE
          WHEN ? > 0 AND break_cycle_seconds < ? AND break_cycle_seconds + COALESCE((SELECT value FROM charge), 0) >= ?
          THEN ? ELSE break_until END,
        break_cycle_seconds = CASE WHEN ? = 0 THEN 0 ELSE MIN(?, break_cycle_seconds + COALESCE((SELECT value FROM charge), 0)) END,
        updated_at = ?
      WHERE child_id = ? AND viewing_day = ?
    `).bind(segment.endEpoch, segment.startEpoch, segment.viewingDay, session.id, sequence ?? null, sequence ?? null,
      settings.breakAfterMinutes * 60, settings.breakAfterMinutes * 60, settings.breakAfterMinutes * 60,
      epoch + settings.breakDurationMinutes * 60, settings.breakAfterMinutes * 60, settings.breakAfterMinutes * 60,
      epoch, session.childId, segment.viewingDay))
    statements.push(binding.prepare(`${charge}
      UPDATE time_pool_usage SET used_seconds = used_seconds + COALESCE((SELECT value FROM charge), 0)
      WHERE pool_id = ? AND viewing_day = ?
    `).bind(...chargeArgs, poolId, segment.viewingDay))
  }
  return statements
}

export function endSessionStatement(binding: D1Database, sessionId: string, instant: Date) {
  return binding.prepare("UPDATE playback_sessions SET last_state = 'ended', ended_at = ?, video_id = NULL WHERE id = ? AND ended_at IS NULL")
    .bind(epochSeconds(instant), sessionId)
}

export async function endActivePlayback(binding: D1Database, childId: number, instant: Date, options: { settings?: Settings; buckets?: string[] } = {}) {
  const db = database(binding)
  const session = await db.query.playbackSessions.findFirst({ where: and(eq(schema.playbackSessions.childId, childId), isNull(schema.playbackSessions.endedAt)) })
  if (!session || (options.buckets?.length && !options.buckets.includes(session.usageBucket))) return
  const settings = options.settings ?? await ensureTimeSettings(db, childId)
  await binding.batch([...settlementStatements(binding, session, settings, instant), endSessionStatement(binding, session.id, instant)])
}

export async function takeOverPlayback(binding: D1Database, input: {
  childId: number; sessionId: string; videoId: string; videoTitle: string; channelTitle: string | null; bucket: UsageBucket; poolId: string; instant: Date; settings: Settings; leaseSeconds: number
}) {
  const { childId, sessionId, videoId, bucket, poolId, instant, settings } = input
  const db = database(binding)
  const day = viewingDayAt(instant, settings.timeZone, settings)
  const epoch = epochSeconds(instant)
  const minute = localMinuteAt(instant, settings.timeZone)
  const allowanceColumn = day.isWeekend ? 'weekend_minutes' : 'weekday_minutes'
  const limit = `CASE WHEN u.unlocked = 1 THEN 86400 ELSE (t.${allowanceColumn} + u.extension_minutes) * 60 END`
  for (let attempt = 0; attempt < 5; attempt++) {
    const previous = await db.query.playbackSessions.findFirst({ where: and(eq(schema.playbackSessions.childId, childId), isNull(schema.playbackSessions.endedAt)) })
    const statements = previous ? [...settlementStatements(binding, previous, settings, instant), endSessionStatement(binding, previous.id, instant)] : []
    statements.push(binding.prepare('INSERT INTO daily_usage_summaries (child_id, viewing_day) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(childId, day.localDate))
    statements.push(binding.prepare('INSERT INTO time_pool_usage (child_id, pool_id, viewing_day) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(childId, poolId, day.localDate))
    const activationIndex = statements.length
    statements.push(binding.prepare(`
      INSERT INTO playback_sessions (id, child_id, viewing_day, last_sequence, last_state, last_acknowledged_at, lease_expires_at, usage_bucket, video_id, time_pool_id)
      SELECT ?, ?, ?, 0, 'paused', ?, ?, ?, ?, ?
      FROM time_pool_usage u JOIN time_pools t ON t.id = u.pool_id JOIN child_time_settings s ON s.child_id = u.child_id JOIN daily_usage_summaries d ON d.child_id = u.child_id AND d.viewing_day = u.viewing_day
      WHERE u.child_id = ? AND u.viewing_day = ? AND u.pool_id = ? AND u.used_seconds < (${limit})
        AND d.playback_paused = 0 AND (d.break_until IS NULL OR d.break_until <= ?)
        AND s.time_zone = ? AND s.allowed_start_minute <= ? AND s.allowed_end_minute > ?
        AND NOT EXISTS (SELECT 1 FROM playback_sessions WHERE child_id = ? AND ended_at IS NULL)
    `).bind(sessionId, childId, day.localDate, epoch, epoch + input.leaseSeconds, bucket, videoId, poolId, childId, day.localDate, poolId, epoch, settings.timeZone, minute, minute, childId))
    statements.push(binding.prepare(`
      INSERT INTO viewing_events (session_id, child_id, video_id, video_title, channel_title, usage_bucket, authorized_at, time_pool_id, time_pool_name)
      SELECT id, child_id, video_id, ?, ?, usage_bucket, ?, time_pool_id, (SELECT name FROM time_pools WHERE id = time_pool_id) FROM playback_sessions WHERE id = ?
      ON CONFLICT DO NOTHING
    `).bind(input.videoTitle, input.channelTitle, epoch, sessionId))
    statements.push(binding.prepare('UPDATE video_recommendations SET seen_at = ? WHERE child_id = ? AND video_id = ? AND seen_at IS NULL AND EXISTS (SELECT 1 FROM playback_sessions WHERE id = ?)')
      .bind(epoch, childId, videoId, sessionId))
    const results = await binding.batch(statements)
    if (results[activationIndex].meta.changes) return true
    // Another activation won between our read and batch. Retry against that
    // session; never terminate a session whose interval we did not settle.
    const active = await db.query.playbackSessions.findFirst({ where: and(eq(schema.playbackSessions.childId, childId), isNull(schema.playbackSessions.endedAt)) })
    if (!active) return false
  }
  return false
}
