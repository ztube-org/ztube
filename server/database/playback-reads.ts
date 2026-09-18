import { and, eq, sql } from 'drizzle-orm'
import type { database } from './client.ts'
import * as schema from './schema.ts'

type Database = ReturnType<typeof database>
function once<T>(prepare: () => T) {
  let query: T | undefined
  return () => query ??= prepare()
}
function prepareReads(db: Database) {
  return {
    pool: once(() => db.select({ pool: schema.timePools, usedSeconds: schema.timePoolUsage.usedSeconds, extensionMinutes: schema.timePoolUsage.extensionMinutes, unlocked: schema.timePoolUsage.unlocked })
      .from(schema.timePools).leftJoin(schema.timePoolUsage, and(eq(schema.timePoolUsage.poolId, schema.timePools.id), eq(schema.timePoolUsage.childId, schema.timePools.childId), eq(schema.timePoolUsage.viewingDay, sql.placeholder('day'))))
      .where(and(eq(schema.timePools.childId, sql.placeholder('childId')), eq(schema.timePools.id, sql.placeholder('poolId')))).limit(1).prepare()),
    settings: once(() => db.query.childTimeSettings.findFirst({ where: eq(schema.childTimeSettings.childId, sql.placeholder('childId')) }).prepare()),
    usage: once(() => db.query.dailyUsageSummaries.findFirst({ where: and(eq(schema.dailyUsageSummaries.childId, sql.placeholder('childId')), eq(schema.dailyUsageSummaries.viewingDay, sql.placeholder('day'))) }).prepare()),
    pools: once(() => db.query.timePools.findMany({ where: eq(schema.timePools.childId, sql.placeholder('childId')) }).prepare()),
    bindings: once(() => db.query.timePoolBindings.findMany({ where: eq(schema.timePoolBindings.childId, sql.placeholder('childId')) }).prepare()),
    session: once(() => db.query.playbackSessions.findFirst({ where: and(eq(schema.playbackSessions.id, sql.placeholder('id')), eq(schema.playbackSessions.childId, sql.placeholder('childId'))) }).prepare()),
    server: once(() => db.query.jellyfinServers.findFirst({ where: eq(schema.jellyfinServers.id, sql.placeholder('id')) }).prepare()),
  }
}
// Cache compiled SQL and row mappings, not the data returned by execute().
const reads = new WeakMap<Database, ReturnType<typeof prepareReads>>()
export function playbackReads(db: Database) {
  let queries = reads.get(db)
  if (!queries) { queries = prepareReads(db); reads.set(db, queries) }
  return queries
}
