import { HTTPException } from 'hono/http-exception'
import type { PlaybackViewingEvent, EpisodeUnlockEvent, ViewingEventsResponse } from '../../src/viewing-events.ts'
import { epochSeconds } from '../utils/viewing-day.ts'

export const VIEWING_EVENT_RETENTION_DAYS = 30
const PAGE_SIZE = 50

type ActivityRow = {
  kind: 'playback' | 'unlock'
  eventKey: string
  occurredAt: number
  sessionId: string | null
  videoId: string
  videoTitle: string
  channelTitle: string | null
  usageBucket: PlaybackViewingEvent['usageBucket'] | null
  timePoolId: string | null
  timePoolName: string | null
  startedAt: number | null
  lastWatchedAt: number | null
  watchedSeconds: number | null
  status: PlaybackViewingEvent['status'] | null
}

export async function viewingEvents(binding: D1Database, childId: number, timeZone: string, instant: Date, cursor?: string): Promise<ViewingEventsResponse> {
  let before: [number, string] | null = null
  if (cursor) {
    try {
      const parsed: unknown = JSON.parse(cursor)
      if (!Array.isArray(parsed) || parsed.length !== 2 || !Number.isSafeInteger(parsed[0]) || parsed[0] < 0 || typeof parsed[1] !== 'string' || parsed[1].length > 66) throw new Error('Invalid cursor')
      // Existing playback-only cursors used the raw session ID.
      before = [parsed[0], /^[pu]:/.test(parsed[1]) ? parsed[1] : `p:${parsed[1]}`]
    } catch { throw new HTTPException(400, { message: 'Invalid viewing event cursor' }) }
  }
  const epoch = epochSeconds(instant)
  const cutoff = epoch - VIEWING_EVENT_RETENTION_DAYS * 86400
  const result = await binding.prepare(`
    WITH activity AS (
      SELECT 'playback' AS kind, 'p:' || e.session_id AS eventKey, e.started_at AS occurredAt,
        e.session_id AS sessionId, e.video_id AS videoId, e.video_title AS videoTitle,
        e.channel_title AS channelTitle, e.usage_bucket AS usageBucket,
        e.time_pool_id AS timePoolId, e.time_pool_name AS timePoolName,
        e.started_at AS startedAt, e.last_watched_at AS lastWatchedAt, e.watched_seconds AS watchedSeconds,
        CASE WHEN p.ended_at IS NOT NULL OR p.lease_expires_at <= ? THEN 'ended' ELSE p.last_state END AS status
      FROM viewing_events e JOIN playback_sessions p ON p.id = e.session_id
      WHERE e.child_id = ? AND e.authorized_at >= ? AND e.watched_seconds > 0
      UNION ALL
      SELECT 'unlock' AS kind, 'u:' || u.video_id AS eventKey, u.unlocked_at AS occurredAt,
        NULL AS sessionId, u.video_id AS videoId,
        COALESCE(
          (SELECT pv.video_title FROM allowed_playlists a JOIN playlist_videos pv ON pv.playlist_id = a.playlist_id WHERE a.child_id = u.child_id AND pv.video_id = u.video_id ORDER BY a.id LIMIT 1),
          (SELECT cv.video_title FROM allowed_channels a JOIN channel_videos cv ON cv.channel_id = a.channel_id WHERE a.child_id = u.child_id AND cv.video_id = u.video_id ORDER BY a.id LIMIT 1),
          (SELECT v.video_title FROM allowed_videos v WHERE v.child_id = u.child_id AND v.video_id = u.video_id),
          (SELECT e.video_title FROM viewing_events e WHERE e.child_id = u.child_id AND e.video_id = u.video_id ORDER BY e.authorized_at DESC LIMIT 1),
          u.video_id
        ) AS videoTitle,
        COALESCE(
          (SELECT COALESCE(pv.channel_title, a.playlist_title) FROM allowed_playlists a JOIN playlist_videos pv ON pv.playlist_id = a.playlist_id WHERE a.child_id = u.child_id AND pv.video_id = u.video_id ORDER BY a.id LIMIT 1),
          (SELECT cv.channel_title FROM allowed_channels a JOIN channel_videos cv ON cv.channel_id = a.channel_id WHERE a.child_id = u.child_id AND cv.video_id = u.video_id ORDER BY a.id LIMIT 1),
          (SELECT v.channel_title FROM allowed_videos v WHERE v.child_id = u.child_id AND v.video_id = u.video_id),
          (SELECT e.channel_title FROM viewing_events e WHERE e.child_id = u.child_id AND e.video_id = u.video_id ORDER BY e.authorized_at DESC LIMIT 1)
        ) AS channelTitle,
        NULL AS usageBucket, NULL AS timePoolId, NULL AS timePoolName,
        NULL AS startedAt, NULL AS lastWatchedAt, NULL AS watchedSeconds, NULL AS status
      FROM episode_unlocks u WHERE u.child_id = ? AND u.unlocked_at >= ?
    )
    SELECT * FROM activity
    ${before ? 'WHERE (occurredAt, eventKey) < (?, ?)' : ''}
    ORDER BY occurredAt DESC, eventKey DESC LIMIT ?
  `).bind(epoch, childId, cutoff, childId, cutoff, ...(before ?? []), PAGE_SIZE + 1).all<ActivityRow>()
  const rows = result.results.slice(0, PAGE_SIZE)
  const events = rows.map((row): PlaybackViewingEvent | EpisodeUnlockEvent => row.kind === 'unlock'
    ? { kind: 'unlock', videoId: row.videoId, videoTitle: row.videoTitle, channelTitle: row.channelTitle, unlockedAt: row.occurredAt }
    : { kind: 'playback', sessionId: row.sessionId!, videoId: row.videoId, videoTitle: row.videoTitle, channelTitle: row.channelTitle,
        usageBucket: row.usageBucket!, timePoolId: row.timePoolId, timePoolName: row.timePoolName,
        startedAt: row.startedAt!, lastWatchedAt: row.lastWatchedAt!, watchedSeconds: row.watchedSeconds!, status: row.status! })
  const last = rows.at(-1)
  return { events, nextCursor: result.results.length > PAGE_SIZE && last ? JSON.stringify([last.occurredAt, last.eventKey]) : null, timeZone, retentionDays: VIEWING_EVENT_RETENTION_DAYS }
}

export async function pruneViewingEvents(binding: D1Database, instant = new Date()) {
  await binding.prepare('DELETE FROM viewing_events WHERE authorized_at < ?')
    .bind(epochSeconds(instant) - VIEWING_EVENT_RETENTION_DAYS * 86400).run()
}
