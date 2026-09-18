import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

test('Workers/D1: racing takeover settles once, enforces the final balance, and rolls back failed batches', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const built = await build({
    stdin: { contents: `
      import { createApp } from './server/app.ts'
      export default { fetch(request, env) {
        const app = createApp({ now: () => new Date(request.headers.get('test-time') || '2026-08-17T12:00:00Z') })
        return app.fetch(request, env)
      } }
    `, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  })
  const worker = new Miniflare(convertV4MiniflareOptions({
    workers: [{
    name: 'ztube-test',
    modules: true, script: built.outputFiles[0].text,
    compatibilityDate: '2026-08-16', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    bindings: { AUTH_MODE: 'local', LOCAL_DEV_USER_EMAIL: 'runtime@example.com', ADMIN_EMAILS: 'runtime@example.com' },
    }],
  }))
  try {
    const db = await worker.getD1Database('DB')
    const migrations = new URL('../migrations/', import.meta.url)
    // D1 exec processes one statement per line; migrations include multiline SQL.
    for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
      const source = await readFile(new URL(name, migrations), 'utf8')
      const statements = (source.replace(/--[^\n]*/g, '').match(/\s*CREATE TRIGGER\b[\s\S]*?\bEND\s*;|[^;]+;/gi) ?? []).map(sql => sql.trim())
      await db.batch(statements.map(sql => db.prepare(sql)))
    }
    const request = (path: string, body?: unknown, time = '2026-08-17T12:00:00Z', method = 'POST') => worker.dispatchFetch(`http://localhost${path}`, {
      method, headers: { 'content-type': 'application/json', 'test-time': time },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    assert.equal((await request('/api/auth/session', undefined, undefined, 'GET')).status, 200)
    await db.batch([
      db.prepare("UPDATE child_time_settings SET weekday_allowance_minutes = 15, time_zone = 'UTC'"),
      db.prepare("INSERT INTO allowed_videos (child_id, video_id, video_title, duration) VALUES (1, 'approved', 'Approved', 600)"),
    ])
    const initial = await (await request('/api/child/playback-authorizations', { videoId: 'approved' })).json() as any
    const id = initial.authorization.sessionId
    assert.equal((await request(`/api/child/playback-authorizations/${id}/heartbeats`, { sequence: 1, state: 'playing' })).status, 200)
    await db.prepare('UPDATE daily_usage_summaries SET restricted_seconds = 895').run()
    const time = '2026-08-17T12:00:10Z'
    const responses = await Promise.all([
      request('/api/child/playback-authorizations', { videoId: 'approved' }, time),
      request('/api/child/playback-authorizations', { videoId: 'approved' }, time),
      request(`/api/child/playback-authorizations/${id}/heartbeats`, { sequence: 2, state: 'playing' }, time),
    ])
    assert.equal(responses[0].status, 403)
    assert.equal(responses[1].status, 403)
    assert.equal(await db.prepare('SELECT restricted_seconds FROM daily_usage_summaries').first('restricted_seconds'), 900)
    await db.batch([
      db.prepare("INSERT INTO allowed_playlists (child_id, playlist_id, playlist_title, cartoon_pool) VALUES (1, 'pool', 'Pool', 1)"),
      db.prepare("INSERT INTO playlist_videos (playlist_id, video_id, video_title, duration) VALUES ('pool', 'ep1', 'Episode 1', 600), ('pool', 'ep2', 'Episode 2', 600)"),
    ])
    const claim = (videoId: string) => request('/api/child/episode-claims', { videoId, viewingDay: '2026-08-17', confirmed: true })
    const claims = await Promise.all([claim('ep1'), claim('ep2')])
    assert.deepEqual(claims.map(response => response.status).sort(), [200, 409])
    assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM episode_claims').first('count'), 1)
    const claimed = await db.prepare('SELECT video_id FROM episode_claims').first<string>('video_id')
    assert.equal((await claim(claimed!)).status, 200, 'D1 retries cannot double-spend a claim')
    const grant = { requestId: crypto.randomUUID(), viewingDay: '2026-08-17' }
    const grants = await Promise.all([request('/api/admin/children/1/unlock-credits', grant), request('/api/admin/children/1/unlock-credits', grant)])
    assert.ok(grants.every(response => response.status === 200))
    assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM episode_credit_grants').first('count'), 1)
    assert.equal((await claim(claimed === 'ep1' ? 'ep2' : 'ep1')).status, 200)
    assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM episode_unlocks').first('count'), 2)
    assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM playback_sessions WHERE ended_at IS NULL').first('count'), 0)
    assert.equal(await db.prepare('SELECT SUM(watched_seconds) AS seconds FROM viewing_events').first('seconds'), 5)
    await assert.rejects(() => db.batch([
      db.prepare('DELETE FROM daily_usage_summaries'),
      db.prepare('INSERT INTO missing_table VALUES (1)'),
    ]))
    assert.equal(await db.prepare('SELECT restricted_seconds FROM daily_usage_summaries').first('restricted_seconds'), 900)
  } finally { await worker.dispose() }
})
