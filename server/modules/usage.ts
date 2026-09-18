import { playbackReads } from '../database/playback-reads.ts'
import { and, eq } from 'drizzle-orm'
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

export async function dailyUsage(db: ReturnType<typeof drizzle<typeof schema>>, childId: number, viewingDay: string, instant?: Date) {
  let summary = await playbackReads(db).usage().execute({ childId, day: viewingDay })
  if (instant && summary?.breakUntil && summary.breakUntil.getTime() <= instant.getTime()) {
    await db.update(schema.dailyUsageSummaries).set({ breakCycleSeconds: 0, breakUntil: null, updatedAt: instant })
      .where(and(eq(schema.dailyUsageSummaries.childId, childId), eq(schema.dailyUsageSummaries.viewingDay, viewingDay), eq(schema.dailyUsageSummaries.breakUntil, summary.breakUntil)))
    summary = { ...summary, breakCycleSeconds: 0, breakUntil: null, updatedAt: instant }
  }
  return {
    cartoonSeconds: summary?.cartoonSeconds ?? 0,
    restrictedSeconds: summary?.restrictedSeconds ?? 0,
    exemptSeconds: summary?.exemptSeconds ?? 0,
    restrictedExtensionMinutes: summary?.restrictedExtensionMinutes ?? 0,
    exemptExtensionMinutes: summary?.exemptExtensionMinutes ?? 0,
    restrictedUnlocked: summary?.restrictedUnlocked ?? false,
    playbackPaused: summary?.playbackPaused ?? false,
    breakCycleSeconds: summary?.breakCycleSeconds ?? 0,
    breakUntil: summary?.breakUntil ?? null,
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
