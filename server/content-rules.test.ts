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
    INSERT INTO parents (id, email) VALUES (1, 'parent@example.com'), (2, 'other@example.com');
    INSERT INTO children (id, parent_id, email) VALUES (10, 1, 'child@example.com'), (11, 1, 'sibling@example.com'), (20, 2, 'other-child@example.com');
    INSERT INTO child_time_settings (child_id, time_zone, weekday_allowance_minutes, weekend_allowance_minutes, safety_cap_minutes)
      VALUES (10, 'UTC', 15, 15, 15), (11, 'UTC', 15, 15, 15), (20, 'UTC', 15, 15, 15);
    INSERT INTO allowed_videos (id, child_id, video_id, video_title, is_available) VALUES
      (100, 10, 'lesson', 'Lesson', 1), (101, 10, 'game', 'Game', 1),
      (110, 11, 'lesson', 'Lesson', 1), (200, 20, 'foreign', 'Foreign', 1);
  `)
  const clock = new Date('2026-08-17T12:00:00.000Z')
  let user: any = { id: 1, email: 'parent@example.com', displayName: null, role: 'parent' }
  const app = createApp({ now: () => new Date(clock), resolveUser: async () => user })
  const env = { DB: d1 as unknown as D1Database } as Env
  const request = (path: string, method = 'GET', body?: unknown) => app.request(path, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }, env)
  return { d1, clock, request, asChild(id = 10) { user = { id, email: 'child@example.com', displayName: null, role: 'child' } } }
}

test('parent manages per-Child Content Rules with ownership enforced', async () => {
  const { d1, request } = await fixture()
  const changed = await request('/api/parent/children/10/content/video/100/rule', 'PUT', { rule: 'exempt' })
  assert.equal(changed.status, 200)
  assert.equal((d1.sqlite.prepare('SELECT content_rule FROM allowed_videos WHERE id = 100').get() as any).content_rule, 'exempt')
  assert.equal((d1.sqlite.prepare('SELECT content_rule FROM allowed_videos WHERE id = 110').get() as any).content_rule, 'restricted')
  assert.equal((await request('/api/parent/children/20/content/video/200/rule', 'PUT', { rule: 'exempt' })).status, 404)
})

test('allowance-exempt playback uses only the Safety Cap bucket', async () => {
  const { d1, clock, request, asChild } = await fixture()
  d1.sqlite.exec("UPDATE allowed_videos SET content_rule = 'exempt' WHERE id = 100")
  asChild()
  const authorization = await (await request('/api/child/playback-authorizations', 'POST', { videoId: 'lesson' })).json() as any
  assert.equal(authorization.authorization.usageBucket, 'exempt')
  const sessionId = authorization.authorization.sessionId
  await request(`/api/child/playback-authorizations/${sessionId}/heartbeats`, 'POST', { sequence: 1, state: 'playing' })
  clock.setSeconds(clock.getSeconds() + 30)
  const heartbeat = await request(`/api/child/playback-authorizations/${sessionId}/heartbeats`, 'POST', { sequence: 2, state: 'paused' })
  assert.equal((await heartbeat.json() as any).remainingSeconds, 870)
  const summary = d1.sqlite.prepare('SELECT restricted_seconds, exempt_seconds FROM daily_usage_summaries').get() as any
  assert.equal(summary.restricted_seconds, 0)
  assert.equal(summary.exempt_seconds, 30)
})

test('each bucket locks independently and exempt content exposes its label data', async () => {
  const { d1, request, asChild } = await fixture()
  d1.sqlite.exec(`
    UPDATE allowed_videos SET content_rule = 'exempt' WHERE id = 100;
    INSERT INTO daily_usage_summaries (child_id, viewing_day, restricted_seconds, exempt_seconds) VALUES (10, '2026-08-17', 900, 30);
  `)
  asChild()
  const browse = await (await request('/api/child/browse')).json() as any
  assert.equal(browse.watchTime.restricted.locked, true)
  assert.equal(browse.watchTime.exempt.locked, false)
  assert.equal(browse.watchTime.exempt.remainingSeconds, 870)
  assert.equal(browse.videos.find((video: any) => video.videoId === 'lesson').contentRule, 'exempt')
  assert.equal((await request('/api/child/playback-authorizations', 'POST', { videoId: 'game' })).status, 403)
  assert.equal((await request('/api/child/playback-authorizations', 'POST', { videoId: 'lesson' })).status, 200)

  d1.sqlite.exec("UPDATE daily_usage_summaries SET restricted_seconds = 0, exempt_seconds = 900 WHERE child_id = 10")
  assert.equal((await request('/api/child/playback-authorizations', 'POST', { videoId: 'lesson' })).status, 403)
  assert.equal((await request('/api/child/playback-authorizations', 'POST', { videoId: 'game' })).status, 200)
})
