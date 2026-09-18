import { playbackReads } from '../database/playback-reads.ts'
import { database } from '../database/client.ts'
import type { Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import * as v from 'valibot'
import * as schema from '../database/schema.ts'
import { requireRole, type AppEnv } from './identity.ts'
import { ensureTimeSettings } from './usage.ts'
import { endActivePlayback } from './playback-ledger.ts'
import { approvedVideoMetadata } from './catalog.ts'
import { viewingDayAt } from '../utils/viewing-day.ts'
import type { TimePoolStatus } from '../../src/domain.ts'

type Database = ReturnType<typeof drizzle<typeof schema>>
const minutes = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1440))
const poolInput = v.object({ name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(40)), weekdayMinutes: minutes, weekendMinutes: minutes, requiresClaim: v.optional(v.boolean(), false) })

export async function poolStatuses(db: Database, childId: number, instant: Date): Promise<TimePoolStatus[]> {
  const settings = await ensureTimeSettings(db, childId)
  const day = viewingDayAt(instant, settings.timeZone, settings)
  const [pools, usage] = await Promise.all([
    db.query.timePools.findMany({ where: eq(schema.timePools.childId, childId) }),
    db.query.timePoolUsage.findMany({ where: and(eq(schema.timePoolUsage.childId, childId), eq(schema.timePoolUsage.viewingDay, day.localDate)) }),
  ])
  return pools.map(pool => {
    const used = usage.find(row => row.poolId === pool.id)
    const allowanceMinutes = day.isWeekend ? pool.weekendMinutes : pool.weekdayMinutes
    const usedSeconds = used?.usedSeconds ?? 0
    const extensionMinutes = used?.extensionMinutes ?? 0
    const unlocked = used?.unlocked ?? false
    const remainingSeconds = Math.max(0, (unlocked ? 86400 : (allowanceMinutes + extensionMinutes) * 60) - usedSeconds)
    return { ...pool, allowanceMinutes, usedSeconds, extensionMinutes, unlocked, remainingSeconds, locked: remainingSeconds === 0 }
  })
}

export async function poolBalance(db: Database, childId: number, poolId: string | null, instant: Date, settings?: schema.ChildTimeSettings): Promise<TimePoolStatus> {
  const currentSettings = settings ?? await ensureTimeSettings(db, childId)
  const day = viewingDayAt(instant, currentSettings.timeZone, currentSettings)
  const [row] = await playbackReads(db).pool().all({ childId, poolId, day: day.localDate })
  if (!row) throw new HTTPException(403, { message: 'Time pool is no longer available' })
  const { pool } = row
  const allowanceMinutes = day.isWeekend ? pool.weekendMinutes : pool.weekdayMinutes
  const usedSeconds = row.usedSeconds ?? 0, extensionMinutes = row.extensionMinutes ?? 0, unlocked = row.unlocked ?? false
  const remainingSeconds = Math.max(0, (unlocked ? 86400 : (allowanceMinutes + extensionMinutes) * 60) - usedSeconds)
  return { ...pool, allowanceMinutes, usedSeconds, extensionMinutes, unlocked, remainingSeconds, locked: remainingSeconds === 0 }
}

export async function cartoonPoolId(db: Database, childId: number) {
  const binding = await db.query.timePoolBindings.findFirst({ where: and(eq(schema.timePoolBindings.childId, childId), eq(schema.timePoolBindings.kind, 'cartoon'), eq(schema.timePoolBindings.contentId, '*')) })
  return binding?.poolId ?? `pool:${childId}:cartoon`
}

export function registerTimePoolRoutes(app: Hono<AppEnv>, now: () => Date) {
  async function admin(c: Context<AppEnv>) {
    requireRole(c.get('user'), 'admin')
    const childId = v.parse(v.pipe(v.number(), v.integer(), v.minValue(1)), Number(c.req.param('id')))
    const db = database(c.env.DB)
    if (!await db.query.children.findFirst({ where: eq(schema.children.id, childId) })) throw new HTTPException(404, { message: 'Child not found' })
    await ensureTimeSettings(db, childId)
    return { db, childId }
  }
  app.get('/api/admin/children/:id/time-pools', async c => {
    const { db, childId } = await admin(c)
    const settings = await ensureTimeSettings(db, childId)
    return c.json({ pools: await poolStatuses(db, childId, now()), bindings: await db.query.timePoolBindings.findMany({ where: eq(schema.timePoolBindings.childId, childId) }), viewingDay: viewingDayAt(now(), settings.timeZone, settings).localDate })
  })
  app.post('/api/admin/children/:id/time-pools', async c => {
    const { db, childId } = await admin(c)
    const input = v.parse(poolInput, await c.req.json())
    const pool = { id: crypto.randomUUID(), childId, ...input }
    await db.insert(schema.timePools).values(pool)
    return c.json({ pool }, 201)
  })
  app.put('/api/admin/children/:id/time-pools/:poolId', async c => {
    const { db, childId } = await admin(c)
    const input = v.parse(poolInput, await c.req.json())
    const pool = await db.query.timePools.findFirst({ where: and(eq(schema.timePools.childId, childId), eq(schema.timePools.id, c.req.param('poolId'))) })
    if (!pool) throw new HTTPException(404, { message: 'Time pool not found' })
    // Finish the previous interval with its original cap before editing it.
    await endActivePlayback(c.env.DB, childId, now())
    await db.update(schema.timePools).set(input).where(eq(schema.timePools.id, pool.id))
    return c.json({ pool: await poolBalance(db, childId, pool.id, now()) })
  })
  app.post('/api/admin/children/:id/time-pools/:poolId/extensions', async c => {
    const { db, childId } = await admin(c)
    const input = v.parse(v.object({ minutes: v.picklist([15, 30, 60]) }), await c.req.json())
    const pool = await poolBalance(db, childId, c.req.param('poolId'), now())
    const settings = await ensureTimeSettings(db, childId)
    const day = viewingDayAt(now(), settings.timeZone, settings).localDate
    await c.env.DB.prepare(`INSERT INTO time_pool_usage (child_id, pool_id, viewing_day, extension_minutes) VALUES (?, ?, ?, ?)
      ON CONFLICT(pool_id, viewing_day) DO UPDATE SET extension_minutes = extension_minutes + excluded.extension_minutes`).bind(childId, pool.id, day, input.minutes).run()
    return c.json({ pool: await poolBalance(db, childId, pool.id, now()) })
  })
  app.put('/api/admin/children/:id/time-pool-bindings', async c => {
    const { db, childId } = await admin(c)
    const input = v.parse(v.object({ kind: v.picklist(['channel', 'playlist', 'video', 'cartoon']), contentId: v.pipe(v.string(), v.minLength(1), v.maxLength(100)), poolId: v.nullable(v.pipe(v.string(), v.minLength(1), v.maxLength(64))) }), await c.req.json())
    if (input.poolId && !await db.query.timePools.findFirst({ where: and(eq(schema.timePools.childId, childId), eq(schema.timePools.id, input.poolId)) })) throw new HTTPException(400, { message: 'Choose a time pool belonging to this Child' })
    const available = input.kind === 'cartoon' ? input.contentId === '*'
      : input.kind === 'video' ? Boolean(await approvedVideoMetadata(db, childId, input.contentId))
      : input.kind === 'channel' ? Boolean(await db.query.allowedChannels.findFirst({ where: and(eq(schema.allowedChannels.childId, childId), eq(schema.allowedChannels.channelId, input.contentId)) }))
      : Boolean(await db.query.allowedPlaylists.findFirst({ where: and(eq(schema.allowedPlaylists.childId, childId), eq(schema.allowedPlaylists.playlistId, input.contentId)) }))
    if (!available) throw new HTTPException(404, { message: 'Approved Content not found' })
    await endActivePlayback(c.env.DB, childId, now())
    if (input.poolId) await db.insert(schema.timePoolBindings).values({ childId, ...input, poolId: input.poolId }).onConflictDoUpdate({ target: [schema.timePoolBindings.childId, schema.timePoolBindings.kind, schema.timePoolBindings.contentId], set: { poolId: input.poolId } })
    else await db.delete(schema.timePoolBindings).where(and(eq(schema.timePoolBindings.childId, childId), eq(schema.timePoolBindings.kind, input.kind), eq(schema.timePoolBindings.contentId, input.contentId)))
    return c.json({ success: true })
  })
}
