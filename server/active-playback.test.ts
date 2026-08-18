import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createApp } from './app.ts'

class IsolatedD1 {
  readonly sqlite = new DatabaseSync(':memory:')
  private pendingBatch: Promise<void> = Promise.resolve()
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
  async batch(statements: ReturnType<IsolatedD1['prepare']>[]) {
    let release!: () => void
    const previous = this.pendingBatch
    this.pendingBatch = new Promise(resolve => { release = resolve })
    await previous
    this.sqlite.exec('BEGIN IMMEDIATE')
    try {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      this.sqlite.exec('COMMIT')
      return results
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    } finally {
      release()
    }
  }
  async exec(sql: string) { this.sqlite.exec(sql); return { count: 1, duration: 0 } }
  withSession() { return this }
}

async function fixture() {
  const d1 = new IsolatedD1()
  for (const migration of ['0001_initial.sql', '0002_child_time_settings.sql', '0003_restricted_watch_time.sql', '0004_active_playback_lease.sql', '0005_content_rules.sql', '0006_video_content_rules.sql', '0007_parent_viewing_day_interventions.sql', '0008_two-role_accounts.sql', '0009_video_classifications.sql', '0010_drop_video_classifications.sql', '0011_video_published_at.sql', '0012_favorites_and_playback_progress.sql', '0013_video_recommendations.sql', '0014_video_descriptions.sql', '0015_library_routines_and_profiles.sql', '0016_forget_ended_playback_video.sql']) {
    await d1.exec(await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'))
  }
  d1.sqlite.exec(`
    INSERT INTO children (id, email) VALUES (10, 'child@example.com');
    INSERT INTO child_time_settings (child_id, time_zone, weekday_allowance_minutes, weekend_allowance_minutes) VALUES (10, 'UTC', 15, 15);
    INSERT INTO allowed_videos (child_id, video_id, video_title, is_available) VALUES (10, 'approved', 'Approved', 1);
  `)
  const clock = new Date('2026-08-17T12:00:00.000Z')
  const app = createApp({ now: () => new Date(clock), resolveUser: async () => ({ id: 10, email: 'child@example.com', displayName: null, role: 'non-admin' }) })
  const env = { DB: d1 as unknown as D1Database } as Env
  const post = (path: string, body: unknown) => app.request(path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, env)
  const authorize = async () => (await (await post('/api/child/playback-authorizations', { videoId: 'approved' })).json() as any).authorization
  const heartbeat = (id: string, sequence: number, state = 'playing') => post(`/api/child/playback-authorizations/${id}/heartbeats`, { sequence, state })
  return { d1, clock, authorize, heartbeat }
}

test('a second player atomically takes over the Child Active Playback', async () => {
  const { d1, authorize, heartbeat } = await fixture()
  const first = await authorize()
  const second = await authorize()

  assert.equal(first.heartbeatIntervalSeconds, 15)
  assert.equal(Date.parse(first.leaseExpiresAt) - Date.parse(first.authorizedAt), 60_000)
  assert.notEqual(first.sessionId, second.sessionId)
  assert.equal((d1.sqlite.prepare('SELECT COUNT(*) AS count FROM playback_sessions WHERE ended_at IS NULL').get() as any).count, 1)
  assert.equal((d1.sqlite.prepare('SELECT video_id FROM playback_sessions WHERE id = ?').get(first.sessionId) as any).video_id, null)
  assert.deepEqual(await (await heartbeat(first.sessionId, 1)).json(), {
    accepted: false, sequence: 0, remainingSeconds: 900, authorized: false,
  })
  assert.equal((await (await heartbeat(second.sessionId, 1)).json() as any).authorized, true)
})

test('splits an acknowledged playing interval at local midnight', async () => {
  const { d1, clock, authorize, heartbeat } = await fixture()
  clock.setUTCHours(23, 59, 50, 0)
  const active = await authorize()
  await heartbeat(active.sessionId, 1)
  clock.setUTCDate(clock.getUTCDate() + 1)
  clock.setUTCHours(0, 0, 10, 0)
  await heartbeat(active.sessionId, 2)

  assert.deepEqual(
    d1.sqlite.prepare('SELECT viewing_day, restricted_seconds FROM daily_usage_summaries ORDER BY viewing_day').all().map(row => ({ ...row })),
    [
      { viewing_day: '2026-08-17', restricted_seconds: 10 },
      { viewing_day: '2026-08-18', restricted_seconds: 10 },
    ],
  )
})

test('forgets the video identity when Playback Authorization ends', async () => {
  const { d1, authorize, heartbeat } = await fixture()
  const active = await authorize()
  await heartbeat(active.sessionId, 1, 'ended')
  const ended = d1.sqlite.prepare('SELECT ended_at, video_id FROM playback_sessions WHERE id = ?').get(active.sessionId) as any
  assert.notEqual(ended.ended_at, null)
  assert.equal(ended.video_id, null)
})

test('an expired lease charges at most its leased interval and requires reauthorization', async () => {
  const { d1, clock, authorize, heartbeat } = await fixture()
  const active = await authorize()
  await heartbeat(active.sessionId, 1)
  clock.setSeconds(clock.getSeconds() + 61)

  const expired = await (await heartbeat(active.sessionId, 2)).json() as any
  assert.equal(expired.accepted, true)
  assert.equal(expired.authorized, false)
  assert.equal(expired.leaseExpiresAt, null)
  assert.equal((d1.sqlite.prepare('SELECT restricted_seconds FROM daily_usage_summaries').get() as any).restricted_seconds, 60)
  assert.equal((await (await heartbeat(active.sessionId, 3)).json() as any).authorized, false)
})

test('duplicate, delayed, and racing heartbeats charge one acknowledged interval', async () => {
  const { d1, clock, authorize, heartbeat } = await fixture()
  const active = await authorize()
  await heartbeat(active.sessionId, 1)
  clock.setSeconds(clock.getSeconds() + 15)

  const [first, duplicate, later] = await Promise.all([
    heartbeat(active.sessionId, 2),
    heartbeat(active.sessionId, 2),
    heartbeat(active.sessionId, 3),
  ])
  const results = await Promise.all([first.json(), duplicate.json(), later.json()]) as any[]
  assert.equal(results.filter(result => result.accepted).length, 2)
  assert.equal((d1.sqlite.prepare('SELECT restricted_seconds FROM daily_usage_summaries').get() as any).restricted_seconds, 15)

  clock.setSeconds(clock.getSeconds() + 15)
  const delayed = await (await heartbeat(active.sessionId, 2)).json() as any
  assert.equal(delayed.accepted, false)
  assert.equal((d1.sqlite.prepare('SELECT restricted_seconds FROM daily_usage_summaries').get() as any).restricted_seconds, 15)
})

test('racing final heartbeats cannot spend beyond the final allowance seconds', async () => {
  const { d1, clock, authorize, heartbeat } = await fixture()
  d1.sqlite.exec("INSERT INTO daily_usage_summaries (child_id, viewing_day, restricted_seconds) VALUES (10, '2026-08-17', 895)")
  const active = await authorize()
  await heartbeat(active.sessionId, 1)
  clock.setSeconds(clock.getSeconds() + 15)

  const responses = await Promise.all([
    heartbeat(active.sessionId, 2),
    heartbeat(active.sessionId, 3),
  ])
  const results = await Promise.all(responses.map(response => response.json())) as any[]
  assert.equal(results.some(result => result.authorized === false), true)
  assert.equal((d1.sqlite.prepare('SELECT restricted_seconds FROM daily_usage_summaries').get() as any).restricted_seconds, 900)
  assert.equal((d1.sqlite.prepare('SELECT COUNT(*) AS count FROM playback_sessions WHERE ended_at IS NULL').get() as any).count, 0)
})

test('the cross-bucket Break Cycle starts and expires a Required Break at its exact threshold', async () => {
  const { d1, clock, authorize, heartbeat } = await fixture()
  d1.sqlite.exec('UPDATE child_time_settings SET weekday_allowance_minutes = 60, weekend_allowance_minutes = 60, break_after_minutes = 15, break_duration_minutes = 5 WHERE child_id = 10')
  const active = await authorize()
  await heartbeat(active.sessionId, 1, 'playing')
  let final: any
  for (let sequence = 2; sequence <= 61; sequence++) {
    clock.setSeconds(clock.getSeconds() + 15)
    final = await (await heartbeat(active.sessionId, sequence, 'playing')).json()
  }
  assert.equal(final.authorized, false)
  const usage = d1.sqlite.prepare("SELECT break_cycle_seconds, break_until FROM daily_usage_summaries WHERE child_id = 10 AND viewing_day = '2026-08-17'").get() as any
  assert.equal(usage.break_cycle_seconds, 900)
  assert.equal(usage.break_until, Math.floor(clock.getTime() / 1000) + 300)
  assert.equal(await authorize(), undefined)
  clock.setSeconds(clock.getSeconds() + 301)
  assert.ok(await authorize())
})
