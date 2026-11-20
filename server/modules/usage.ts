import { playbackReads } from '../database/playback-reads.ts'
import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { HTTPException } from 'hono/http-exception'
import * as schema from '../database/schema.ts'
import type { UsageBucket } from '../../src/domain.ts'

export async function ensureTimeSettings(db: ReturnType<typeof drizzle<typeof schema>>, childId: number) {
  let settings = await playbackReads(db).settings().execute({ childId })
  if (!settings) {
    await db.insert(schema.childTimeSettings).values({ childId }).onConflictDoNothing()
    settings = await playbackReads(db).settings().execute({ childId })
  }
  if (!settings) throw new HTTPException(500, { message: 'Unable to create time settings' })
  return settings
}

type DailyUsageRow = {
  viewingDay: string
  restrictedSeconds: number
  exemptSeconds: number
  cartoonSeconds: number
  customPoolSeconds: number
  restrictedExtensionMinutes: number
  exemptExtensionMinutes: number
  restrictedUnlocked: number
  playbackPaused: number
  breakCycleSeconds: number
  breakUntil: number | null
}

async function usageForDays(db: ReturnType<typeof drizzle<typeof schema>>, childId: number, viewingDays: string[]) {
  return db.all<DailyUsageRow>(sql`
    SELECT day.value AS viewingDay,
      coalesce(max(CASE WHEN p.legacy_key = 'restricted' THEN u.used_seconds END), s.restricted_seconds, 0) AS restrictedSeconds,
      coalesce(max(CASE WHEN p.legacy_key = 'exempt' THEN u.used_seconds END), s.exempt_seconds, 0) AS exemptSeconds,
      coalesce(max(CASE WHEN p.legacy_key = 'cartoon' THEN u.used_seconds END), s.cartoon_seconds, 0) AS cartoonSeconds,
      coalesce(sum(CASE WHEN p.legacy_key IS NULL THEN u.used_seconds END), 0) AS customPoolSeconds,
      coalesce(max(CASE WHEN p.legacy_key = 'restricted' THEN u.extension_minutes END), s.restricted_extension_minutes, 0) AS restrictedExtensionMinutes,
      coalesce(max(CASE WHEN p.legacy_key = 'exempt' THEN u.extension_minutes END), s.exempt_extension_minutes, 0) AS exemptExtensionMinutes,
      coalesce(max(CASE WHEN p.legacy_key = 'restricted' THEN u.unlocked END), s.restricted_unlocked, 0) AS restrictedUnlocked,
      coalesce(s.playback_paused, 0) AS playbackPaused, coalesce(s.break_cycle_seconds, 0) AS breakCycleSeconds,
      s.break_until AS breakUntil
    FROM json_each(${JSON.stringify(viewingDays)}) day
    LEFT JOIN daily_usage_summaries s ON s.child_id = ${childId} AND s.viewing_day = day.value
    LEFT JOIN time_pools p ON p.child_id = ${childId}
    LEFT JOIN time_pool_usage u ON u.pool_id = p.id AND u.viewing_day = day.value
    GROUP BY day.key ORDER BY day.key
  `)
}

export async function dailyUsageHistory(db: ReturnType<typeof drizzle<typeof schema>>, childId: number, viewingDays: string[]) {
  const rows = await usageForDays(db, childId, viewingDays)
  return rows.map(({ viewingDay, restrictedSeconds, exemptSeconds, cartoonSeconds, customPoolSeconds }) => ({
    viewingDay, restrictedSeconds, exemptSeconds, cartoonSeconds,
    totalSeconds: customPoolSeconds + restrictedSeconds + exemptSeconds + cartoonSeconds,
  }))
}

export async function dailyUsage(db: ReturnType<typeof drizzle<typeof schema>>, childId: number, viewingDay: string, instant?: Date) {
  const [row] = await usageForDays(db, childId, [viewingDay])
  const { cartoonSeconds, restrictedSeconds, exemptSeconds, restrictedExtensionMinutes, exemptExtensionMinutes } = row
  let breakUntil = row.breakUntil === null ? null : new Date(row.breakUntil * 1000)
  let breakCycleSeconds = row.breakCycleSeconds
  if (instant && breakUntil && breakUntil.getTime() <= instant.getTime()) {
    await db.update(schema.dailyUsageSummaries).set({ breakCycleSeconds: 0, breakUntil: null, updatedAt: instant })
      .where(and(eq(schema.dailyUsageSummaries.childId, childId), eq(schema.dailyUsageSummaries.viewingDay, viewingDay), eq(schema.dailyUsageSummaries.breakUntil, breakUntil)))
    breakUntil = null
    breakCycleSeconds = 0
  }
  return {
    cartoonSeconds, restrictedSeconds, exemptSeconds, restrictedExtensionMinutes, exemptExtensionMinutes,
    restrictedUnlocked: Boolean(row.restrictedUnlocked), playbackPaused: Boolean(row.playbackPaused),
    breakCycleSeconds, breakUntil,
  }
}

export async function ensureDailyUsage(db: ReturnType<typeof drizzle<typeof schema>>, childId: number, viewingDay: string) {
  await db.insert(schema.dailyUsageSummaries).values({ childId, viewingDay }).onConflictDoNothing()
}

export type Usage = Awaited<ReturnType<typeof dailyUsage>>

export function effectiveLimits(allowanceMinutes: number, safetyCapMinutes: number, usage: Usage): [number, number] {
  const restricted = usage.restrictedUnlocked ? 24 * 60 * 60 : (allowanceMinutes + usage.restrictedExtensionMinutes) * 60
  return [restricted, (safetyCapMinutes + usage.exemptExtensionMinutes) * 60]
}

export function watchTimeStatus(allowanceSeconds: number, safetyCapSeconds: number, usage: Usage, cartoonMinutes = 30) {
  return {
    cartoon: {
      usedSeconds: usage.cartoonSeconds,
      remainingSeconds: Math.max(0, cartoonMinutes * 60 - usage.cartoonSeconds),
      locked: usage.cartoonSeconds >= cartoonMinutes * 60,
    },
    usedSeconds: usage.restrictedSeconds,
    remainingSeconds: Math.max(0, allowanceSeconds - usage.restrictedSeconds),
    locked: usage.restrictedSeconds >= allowanceSeconds,
    restricted: {
      usedSeconds: usage.restrictedSeconds,
      remainingSeconds: Math.max(0, allowanceSeconds - usage.restrictedSeconds),
      locked: usage.restrictedSeconds >= allowanceSeconds,
      unlocked: usage.restrictedUnlocked,
    },
    exempt: {
      usedSeconds: usage.exemptSeconds,
      remainingSeconds: Math.max(0, safetyCapSeconds - usage.exemptSeconds),
      locked: usage.exemptSeconds >= safetyCapSeconds,
    },
  }
}

export function adminWatchTimeStatus(viewingDay: string, allowanceMinutes: number, safetyCapMinutes: number, usage: Usage, cartoonMinutes = 30) {
  const [allowanceSeconds, safetyCapSeconds] = effectiveLimits(allowanceMinutes, safetyCapMinutes, usage)
  const status = watchTimeStatus(allowanceSeconds, safetyCapSeconds, usage, cartoonMinutes)
  return {
    viewingDay,
    cartoon: { ...status.cartoon, usedMinutes: Math.floor(usage.cartoonSeconds / 60), remainingMinutes: Math.ceil(status.cartoon.remainingSeconds / 60) },
    restricted: {
      ...status.restricted,
      usedMinutes: Math.floor(usage.restrictedSeconds / 60),
      remainingMinutes: usage.restrictedUnlocked ? null : Math.ceil(status.restricted.remainingSeconds / 60),
      extensionMinutes: usage.restrictedExtensionMinutes,
    },
    exempt: {
      ...status.exempt,
      usedMinutes: Math.floor(usage.exemptSeconds / 60),
      remainingMinutes: Math.ceil(status.exempt.remainingSeconds / 60),
      extensionMinutes: usage.exemptExtensionMinutes,
    },
  }
}

export function bucketUsedSeconds(bucket: UsageBucket, usage: Usage) {
  return bucket === 'cartoon' ? usage.cartoonSeconds : bucket === 'exempt' ? usage.exemptSeconds : usage.restrictedSeconds
}

export function bucketLimitSeconds(bucket: UsageBucket, settings: schema.ChildTimeSettings, allowanceMinutes: number, usage: Usage) {
  if (bucket === 'cartoon') return settings.cartoonAllowanceMinutes * 60
  return effectiveLimits(allowanceMinutes, settings.safetyCapMinutes, usage)[bucket === 'exempt' ? 1 : 0]
}

export function bucketExhaustedMessage(bucket: UsageBucket) {
  return bucket === 'cartoon' ? 'Cartoon Time exhausted' : bucket === 'exempt' ? 'Safety Cap exhausted' : 'Daily Allowance exhausted'
}
