import { sql } from 'drizzle-orm'
import type { database } from '../database/client.ts'
import type { AdminChildViewing } from '../../src/domain.ts'
import { playbackPolicyAt } from '../utils/playback-policy.ts'
import { epochSeconds, viewingDayAt } from '../utils/viewing-day.ts'
import { timePoolBalance } from './time-pools.ts'

type ViewingChild = { id: number; settings: {
  timeZone: string
  weekdayAllowanceMinutes: number
  weekendAllowanceMinutes: number
  allowedStartMinute: number
  allowedEndMinute: number
  breakAfterMinutes: number
  breakDurationMinutes: number
} | null }

type ViewingRow = {
  childId: number
  poolId: string | null
  poolName: string
  weekdayMinutes: number
  weekendMinutes: number
  usedSeconds: number | null
  extensionMinutes: number | null
  unlocked: number | null
  playbackPaused: number | null
  breakUntil: number | null
  watching: number
  videoTitle: string | null
}

export async function adminViewingSummaries(db: ReturnType<typeof database>, children: ViewingChild[], instant: Date) {
  const epoch = epochSeconds(instant)
  const viewingDays = children.map(({ id, settings }) => {
    const policy = settings ?? {
      timeZone: 'UTC', weekdayAllowanceMinutes: 60, weekendAllowanceMinutes: 120,
      allowedStartMinute: 0, allowedEndMinute: 1440, breakAfterMinutes: 0, breakDurationMinutes: 15,
    }
    return { id, policy, ...viewingDayAt(instant, policy.timeZone, policy) }
  })
  const days = JSON.stringify(Object.fromEntries(viewingDays.map(day => [day.id, day.localDate])))
  const rows = await db.all<ViewingRow>(sql`
    SELECT cast(day.key AS integer) AS childId,
      p.id AS poolId, p.name AS poolName, p.weekday_minutes AS weekdayMinutes, p.weekend_minutes AS weekendMinutes,
      u.used_seconds AS usedSeconds, u.extension_minutes AS extensionMinutes, u.unlocked,
      d.playback_paused AS playbackPaused, d.break_until AS breakUntil,
      s.id IS NOT NULL AS watching, e.video_title AS videoTitle
    FROM json_each(${days}) day
    LEFT JOIN daily_usage_summaries d ON d.child_id = cast(day.key AS integer) AND d.viewing_day = day.value
    LEFT JOIN time_pools p ON p.child_id = cast(day.key AS integer)
    LEFT JOIN time_pool_usage u ON u.pool_id = p.id AND u.viewing_day = day.value
    LEFT JOIN playback_sessions s ON s.child_id = cast(day.key AS integer) AND s.ended_at IS NULL
      AND s.last_state = 'playing' AND s.lease_expires_at > ${epoch}
    LEFT JOIN viewing_events e ON e.session_id = s.id
    ORDER BY p.name COLLATE NOCASE, p.id
  `)
  const byChild = new Map<number, ViewingRow[]>()
  for (const row of rows) {
    const childRows = byChild.get(row.childId) ?? []
    childRows.push(row)
    byChild.set(row.childId, childRows)
  }
  return new Map<number, AdminChildViewing>(viewingDays.map(day => {
    const childRows = byChild.get(day.id) ?? []
    const today = childRows[0]
    const policy = playbackPolicyAt(instant, day.policy, {
      playbackPaused: Boolean(today?.playbackPaused),
      breakUntil: today?.breakUntil && today.breakUntil > epoch ? new Date(today.breakUntil * 1000) : null,
    })
    const { blocked, reason, breakUntil, nextWindow } = policy
    const watching = Boolean(today?.watching) && !blocked
    const pools = childRows.flatMap(row => {
      if (!row.poolId) return []
      const allowanceMinutes = day.isWeekend ? row.weekendMinutes : row.weekdayMinutes
      const { remainingSeconds, locked } = timePoolBalance(allowanceMinutes, row.usedSeconds ?? 0, row.extensionMinutes ?? 0, Boolean(row.unlocked))
      return [{ id: row.poolId, name: row.poolName, allowanceMinutes, remainingSeconds, locked }]
    })
    return [day.id, {
      pools, policy: { blocked, reason, breakUntil, nextWindow },
      activePlayback: { watching, videoTitle: watching ? today.videoTitle : null },
    }]
  }))
}
