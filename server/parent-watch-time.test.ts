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
  for (const migration of ['0001_initial.sql', '0002_child_time_settings.sql', '0003_restricted_watch_time.sql', '0004_active_playback_lease.sql', '0005_content_rules.sql', '0006_video_content_rules.sql', '0007_parent_viewing_day_interventions.sql']) {
    await d1.exec(await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'))
  }
  d1.sqlite.exec(`
    INSERT INTO parents (id, email) VALUES (1, 'parent@example.com'), (2, 'other@example.com');
    INSERT INTO children (id, parent_id, email) VALUES (10, 1, 'child@example.com'), (20, 2, 'other@example.com');
    INSERT INTO child_time_settings (child_id, time_zone, weekday_allowance_minutes, weekend_allowance_minutes, safety_cap_minutes)
      VALUES (10, 'America/Los_Angeles', 60, 120, 180), (20, 'UTC', 60, 120, 180);
    INSERT INTO daily_usage_summaries (child_id, viewing_day, restricted_seconds, exempt_seconds)
      VALUES (10, '2026-08-16', 301, 601);
  `)
  const clock = new Date('2026-08-16T19:00:00.000Z')
  let user: any = { id: 1, email: 'parent@example.com', displayName: null, role: 'parent' }
  const app = createApp({ now: () => new Date(clock), resolveUser: async () => user })
  const env = { DB: d1 as unknown as D1Database } as Env
  const request = (path: string, method = 'GET', body?: unknown) => app.request(path, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }, env)
  return { d1, clock, request, asChild() { user = { id: 10, email: 'child@example.com', displayName: null, role: 'child' } } }
}

test('parent sees whole-minute buckets and can extend each independently', async () => {
  const { request } = await fixture()
  const initial = await (await request('/api/parent/children/10/watch-time')).json() as any
  assert.equal(initial.viewingDay, '2026-08-16')
  assert.deepEqual([initial.restricted.usedMinutes, initial.restricted.remainingMinutes], [5, 115])
  assert.deepEqual([initial.exempt.usedMinutes, initial.exempt.remainingMinutes], [10, 170])

  const restricted = await (await request('/api/parent/children/10/watch-time/extensions', 'POST', { bucket: 'restricted', minutes: 15 })).json() as any
  assert.equal(restricted.restricted.extensionMinutes, 15)
  assert.equal(restricted.exempt.extensionMinutes, 0)
  const exempt = await (await request('/api/parent/children/10/watch-time/extensions', 'POST', { bucket: 'exempt', minutes: 30 })).json() as any
  assert.equal(exempt.exempt.extensionMinutes, 30)
  assert.equal((await request('/api/parent/children/20/watch-time/extensions', 'POST', { bucket: 'restricted', minutes: 15 })).status, 404)
})

test('ordinary unlock is isolated from the Safety Cap and expires at local midnight across DST', async () => {
  const { clock, request } = await fixture()
  const unlocked = await (await request('/api/parent/children/10/watch-time/restricted-unlock', 'PUT', { unlocked: true })).json() as any
  assert.equal(unlocked.restricted.unlocked, true)
  assert.equal(unlocked.restricted.remainingMinutes, null)
  assert.equal(unlocked.exempt.unlocked, undefined)

  // November 1, 2026 repeats an hour in Los Angeles; the intervention remains tied to its local date.
  clock.setTime(new Date('2026-11-01T08:30:00.000Z').getTime())
  await request('/api/parent/children/10/watch-time/extensions', 'POST', { bucket: 'restricted', minutes: 15 })
  clock.setTime(new Date('2026-11-01T09:30:00.000Z').getTime())
  assert.equal(((await (await request('/api/parent/children/10/watch-time')).json() as any).restricted.extensionMinutes), 15)
  clock.setTime(new Date('2026-11-02T08:00:00.000Z').getTime())
  const nextDay = await (await request('/api/parent/children/10/watch-time')).json() as any
  assert.equal(nextDay.restricted.extensionMinutes, 0)
  assert.equal(nextDay.restricted.unlocked, false)
})

test('a recurring reduction requires warning confirmation and ends affected Active Playback', async () => {
  const { d1, request } = await fixture()
  d1.sqlite.exec(`
    UPDATE daily_usage_summaries SET restricted_seconds = 900 WHERE child_id = 10 AND viewing_day = '2026-08-16';
    INSERT INTO playback_sessions (id, child_id, viewing_day, last_sequence, last_state, last_acknowledged_at, lease_expires_at, usage_bucket)
      VALUES ('active', 10, '2026-08-16', 1, 'playing', 1786906800, 1786906860, 'restricted');
  `)
  const settings = { timeZone: 'America/Los_Angeles', weekdayAllowanceMinutes: 15, weekendAllowanceMinutes: 15, safetyCapMinutes: 180 }
  const warning = await request('/api/parent/children/10/time-settings', 'PUT', settings)
  assert.equal(warning.status, 409)
  assert.equal((await warning.json() as any).requiresConfirmation, true)
  assert.equal((d1.sqlite.prepare("SELECT ended_at FROM playback_sessions WHERE id = 'active'").get() as any).ended_at, null)

  assert.equal((await request('/api/parent/children/10/time-settings', 'PUT', { ...settings, confirmReduction: true })).status, 200)
  assert.notEqual((d1.sqlite.prepare("SELECT ended_at FROM playback_sessions WHERE id = 'active'").get() as any).ended_at, null)
})
