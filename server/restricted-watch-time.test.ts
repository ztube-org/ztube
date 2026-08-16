import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createApp } from './app.ts'

class IsolatedD1 {
  readonly sqlite = new DatabaseSync(':memory:')
  prepare(sql: string) {
    const database = this.sqlite
    let values: unknown[] = []
    const statement = () => database.prepare(sql)
    const api = {
      bind(...bindings: unknown[]) { values = bindings; return api },
      async first<T>(column?: string) { const row = statement().get(...values) as Record<string, unknown> | undefined; return (column ? row?.[column] : row) as T | null ?? null },
      async all<T>() { return { success: true, results: statement().all(...values) as T[] } },
      async run() { const result = statement().run(...values); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } } },
      async raw<T>() { return statement().all(...values).map(row => Object.values(row)) as T[] },
    }
    return api
  }
  async batch(statements: ReturnType<IsolatedD1['prepare']>[]) { return Promise.all(statements.map(statement => statement.run())) }
  async exec(sql: string) { this.sqlite.exec(sql); return { count: 1, duration: 0 } }
  withSession() { return this }
}

async function fixture() {
  const d1 = new IsolatedD1()
  for (const migration of ['0001_initial.sql', '0002_child_time_settings.sql', '0003_restricted_watch_time.sql', '0004_active_playback_lease.sql', '0005_content_rules.sql']) {
    await d1.exec(await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'))
  }
  d1.sqlite.exec(`
    INSERT INTO parents (id, email) VALUES (1, 'parent@example.com');
    INSERT INTO children (id, parent_id, email) VALUES (10, 1, 'child@example.com');
    INSERT INTO child_time_settings (child_id, time_zone, weekday_allowance_minutes, weekend_allowance_minutes) VALUES (10, 'UTC', 15, 15);
    INSERT INTO allowed_videos (child_id, video_id, video_title, is_available) VALUES (10, 'approved', 'Approved', 1);
  `)
  const clock = new Date('2026-08-17T12:00:00.000Z')
  const app = createApp({ now: () => new Date(clock), resolveUser: async () => ({ id: 10, email: 'child@example.com', displayName: null, role: 'child' }) })
  const env = { DB: d1 as unknown as D1Database } as Env
  const request = (path: string, body?: unknown) => app.request(path, body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, env)
  const authorization = await (await request('/api/child/playback-authorizations', { videoId: 'approved' })).json() as any
  return { d1, clock, request, sessionId: authorization.authorization.sessionId }
}

test('counts server wall-clock time only after an acknowledged playing state', async () => {
  const { d1, clock, request, sessionId } = await fixture()
  await request(`/api/child/playback-authorizations/${sessionId}/heartbeats`, { sequence: 1, state: 'playing' })
  clock.setSeconds(clock.getSeconds() + 30)
  const response = await request(`/api/child/playback-authorizations/${sessionId}/heartbeats`, { sequence: 2, state: 'paused' })
  assert.deepEqual(await response.json(), { accepted: true, sequence: 2, remainingSeconds: 870, authorized: true, leaseExpiresAt: '2026-08-17T12:01:30.000Z' })
  clock.setSeconds(clock.getSeconds() + 60)
  await request(`/api/child/playback-authorizations/${sessionId}/heartbeats`, { sequence: 3, state: 'buffering' })
  const summary = d1.sqlite.prepare('SELECT restricted_seconds, exempt_seconds FROM daily_usage_summaries').get() as any
  assert.equal(summary.restricted_seconds, 30)
  assert.equal(summary.exempt_seconds, 0)
})

test('ignores duplicate heartbeats and never accepts a client usage total', async () => {
  const { d1, clock, request, sessionId } = await fixture()
  await request(`/api/child/playback-authorizations/${sessionId}/heartbeats`, { sequence: 1, state: 'playing', usedSeconds: 899 })
  clock.setSeconds(clock.getSeconds() + 10)
  await request(`/api/child/playback-authorizations/${sessionId}/heartbeats`, { sequence: 2, state: 'playing', usedSeconds: 899 })
  clock.setSeconds(clock.getSeconds() + 10)
  const duplicate = await request(`/api/child/playback-authorizations/${sessionId}/heartbeats`, { sequence: 2, state: 'playing', usedSeconds: 899 })
  assert.equal((await duplicate.json() as any).accepted, false)
  assert.equal((d1.sqlite.prepare('SELECT restricted_seconds FROM daily_usage_summaries').get() as any).restricted_seconds, 10)
})

test('ends Playback Authorization at zero and exposes locked but discoverable content', async () => {
  const { d1, clock, request, sessionId } = await fixture()
  d1.sqlite.exec("INSERT INTO daily_usage_summaries (child_id, viewing_day, restricted_seconds) VALUES (10, '2026-08-17', 895)")
  await request(`/api/child/playback-authorizations/${sessionId}/heartbeats`, { sequence: 1, state: 'playing' })
  clock.setSeconds(clock.getSeconds() + 10)
  const result = await request(`/api/child/playback-authorizations/${sessionId}/heartbeats`, { sequence: 2, state: 'playing' })
  assert.deepEqual(await result.json(), { accepted: true, sequence: 2, remainingSeconds: 0, authorized: false, leaseExpiresAt: null })
  const browse = await (await request('/api/child/browse')).json() as any
  assert.equal(browse.watchTime.locked, true)
  assert.equal(browse.videos[0].videoId, 'approved')
  assert.equal((await request('/api/child/playback-authorizations', { videoId: 'approved' })).status, 403)
})
