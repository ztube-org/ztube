import { database } from '../database/client.ts'
import { pruneViewingEvents } from '../modules/viewing-events.ts'
import { pruneEpisodeClaims } from '../modules/episode-claims.ts'
import { and, isNull, lte } from 'drizzle-orm'
import * as schema from '../database/schema.ts'
import { settlementStatements } from '../modules/playback-ledger.ts'
import { ensureTimeSettings } from '../modules/usage.ts'
import { epochSeconds } from './viewing-day.ts'

export async function expirePlaybackSessions(env: Pick<Env, 'DB'>, instant = new Date()) {
  const db = database(env.DB)
  const expired = await db.query.playbackSessions.findMany({ where: and(isNull(schema.playbackSessions.endedAt), lte(schema.playbackSessions.leaseExpiresAt, instant)) })
  let ended = 0
  for (const session of expired) {
    const settings = await ensureTimeSettings(db, session.childId)
    const statements = settlementStatements(env.DB, session, settings, session.leaseExpiresAt)
    statements.push(env.DB.prepare("UPDATE playback_sessions SET last_state = 'ended', ended_at = lease_expires_at, video_id = NULL WHERE id = ? AND ended_at IS NULL AND lease_expires_at <= ?")
      .bind(session.id, epochSeconds(instant)))
    const results = await env.DB.batch(statements)
    ended += Number(results.at(-1)?.meta.changes ?? 0)
  }
  await pruneViewingEvents(env.DB, instant)
  await pruneEpisodeClaims(env.DB, instant)
  return ended
}
