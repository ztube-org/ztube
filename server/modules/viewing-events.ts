import { HTTPException } from 'hono/http-exception'
import type { ViewingEvent, ViewingEventsResponse } from '../../src/viewing-events.ts'
import { epochSeconds } from '../utils/viewing-day.ts'

export const VIEWING_EVENT_RETENTION_DAYS = 30
const PAGE_SIZE = 50

export async function viewingEvents(binding: D1Database, childId: number, timeZone: string, instant: Date, cursor?: string): Promise<ViewingEventsResponse> {
  let before: [number, string] | null = null
  if (cursor) {
    try {
      const parsed: unknown = JSON.parse(cursor)
      if (!Array.isArray(parsed) || parsed.length !== 2 || !Number.isSafeInteger(parsed[0]) || parsed[0] < 0 || typeof parsed[1] !== 'string' || parsed[1].length > 64) throw new Error('Invalid cursor')
      before = parsed as [number, string]
    } catch { throw new HTTPException(400, { message: 'Invalid viewing event cursor' }) }
  }
  const epoch = epochSeconds(instant)
  const result = await binding.prepare(`
    SELECT e.session_id AS sessionId, e.video_id AS videoId, e.video_title AS videoTitle,
      e.channel_title AS channelTitle, e.usage_bucket AS usageBucket,
      e.time_pool_id AS timePoolId, e.time_pool_name AS timePoolName,
      e.started_at AS startedAt, e.last_watched_at AS lastWatchedAt, e.watched_seconds AS watchedSeconds,
      CASE WHEN p.ended_at IS NOT NULL OR p.lease_expires_at <= ? THEN 'ended' ELSE p.last_state END AS status
    FROM viewing_events e JOIN playback_sessions p ON p.id = e.session_id
    WHERE e.child_id = ? AND e.authorized_at >= ? AND e.watched_seconds > 0
      ${before ? 'AND (e.started_at, e.session_id) < (?, ?)' : ''}
    ORDER BY e.started_at DESC, e.session_id DESC LIMIT ?
  `).bind(epoch, childId, epoch - VIEWING_EVENT_RETENTION_DAYS * 86400, ...(before ?? []), PAGE_SIZE + 1).all<ViewingEvent>()
  const events = result.results.slice(0, PAGE_SIZE)
  const last = events.at(-1)
  return { events, nextCursor: result.results.length > PAGE_SIZE && last ? JSON.stringify([last.startedAt, last.sessionId]) : null, timeZone, retentionDays: VIEWING_EVENT_RETENTION_DAYS }
}

export async function pruneViewingEvents(binding: D1Database, instant = new Date()) {
  await binding.prepare('DELETE FROM viewing_events WHERE authorized_at < ?')
    .bind(epochSeconds(instant) - VIEWING_EVENT_RETENTION_DAYS * 86400).run()
}
