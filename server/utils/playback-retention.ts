export async function expirePlaybackSessions(env: Pick<Env, 'DB'>, instant = new Date()) {
  const epoch = Math.floor(instant.getTime() / 1000)
  const result = await env.DB.prepare(`
    UPDATE playback_sessions
    SET last_state = 'ended', ended_at = lease_expires_at, video_id = NULL
    WHERE ended_at IS NULL AND lease_expires_at <= ?
  `).bind(epoch).run()
  return Number(result.meta.changes ?? 0)
}
