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
  for (const migration of [
    '0001_initial.sql',
    '0002_child_time_settings.sql',
    '0003_restricted_watch_time.sql',
    '0004_active_playback_lease.sql',
    '0005_content_rules.sql',
    '0006_video_content_rules.sql',
    '0007_parent_viewing_day_interventions.sql',
  ]) await d1.exec(await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'))
  d1.sqlite.exec(`
    INSERT INTO parents (id, email) VALUES (1, 'parent@example.com'), (2, 'other-parent@example.com');
    INSERT INTO children (id, parent_id, email) VALUES (10, 1, 'child@example.com'), (20, 2, 'other-child@example.com');
    INSERT INTO child_time_settings (child_id, time_zone) VALUES (10, 'America/Los_Angeles'), (20, 'UTC');
    INSERT INTO allowed_channels (id, child_id, channel_id, uploads_playlist_id, channel_title, content_rule)
      VALUES (100, 10, 'channel', 'uploads', 'Channel', 'exempt');
    INSERT INTO allowed_playlists (id, child_id, playlist_id, playlist_title, content_rule)
      VALUES (101, 10, 'playlist', 'Playlist', 'restricted');
    INSERT INTO allowed_videos (id, child_id, video_id, video_title, content_rule)
      VALUES (102, 10, 'standalone', 'Standalone', 'restricted');
    INSERT INTO video_content_rules (child_id, video_id, video_title, content_rule)
      VALUES (10, 'override', 'Override', 'exempt');
    INSERT INTO daily_usage_summaries
      (child_id, viewing_day, restricted_seconds, exempt_seconds, restricted_extension_minutes, exempt_extension_minutes, restricted_unlocked)
      VALUES
      (10, '2026-08-15', 120, 30, 15, 0, 0),
      (10, '2026-08-16', 240, 60, 0, 30, 1);
    INSERT INTO playback_sessions
      (id, child_id, viewing_day, last_sequence, last_state, last_acknowledged_at, lease_expires_at, usage_bucket)
      VALUES ('session', 10, '2026-08-16', 1, 'playing', 1786906800, 1786906860, 'restricted');
  `)
  const app = createApp({
    now: () => new Date('2026-08-16T19:00:00.000Z'),
    resolveUser: async () => ({ id: 1, email: 'parent@example.com', displayName: null, role: 'parent' }),
  })
  const env = { DB: d1 as unknown as D1Database } as Env
  const request = (path: string, method = 'GET', body?: unknown) => app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env)
  return { d1, request }
}

test('Daily Usage Summaries retain aggregates across Viewing Days without per-video history', async () => {
  const { d1, request } = await fixture()
  const columns = d1.sqlite.prepare("PRAGMA table_info('daily_usage_summaries')").all() as Array<{ name: string }>
  assert.equal(columns.some(column => column.name.includes('video')), false)
  assert.deepEqual(
    d1.sqlite.prepare('SELECT viewing_day, restricted_seconds, exempt_seconds FROM daily_usage_summaries WHERE child_id = 10 ORDER BY viewing_day').all().map(row => ({ ...row })),
    [
      { viewing_day: '2026-08-15', restricted_seconds: 120, exempt_seconds: 30 },
      { viewing_day: '2026-08-16', restricted_seconds: 240, exempt_seconds: 60 },
    ],
  )

  const today = await (await request('/api/parent/children/10/watch-time')).json() as any
  assert.equal(today.viewingDay, '2026-08-16')
  assert.equal(today.restricted.usedSeconds, 240)
  assert.equal(today.exempt.usedSeconds, 60)
  assert.equal('history' in today, false)
})

test('deleting a Child is owned, complete, irreversible, and recreation starts with defaults', async () => {
  const { d1, request } = await fixture()
  assert.equal((await request('/api/parent/children/20', 'DELETE')).status, 404)
  assert.equal((await request('/api/parent/children/10', 'DELETE')).status, 204)

  for (const table of [
    'children',
    'child_time_settings',
    'allowed_channels',
    'allowed_playlists',
    'allowed_videos',
    'video_content_rules',
    'daily_usage_summaries',
    'playback_sessions',
  ]) {
    const row = d1.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${table === 'children' ? 'id' : 'child_id'} = 10`).get() as { count: number }
    assert.equal(row.count, 0, `${table} should be deleted`)
  }

  const recreatedResponse = await request('/api/parent/children', 'POST', {
    email: 'child@example.com',
    displayName: 'New Child',
    timeZone: 'America/Los_Angeles',
  })
  assert.equal(recreatedResponse.status, 201)
  const recreated = await recreatedResponse.json() as { id: number }
  assert.notEqual(recreated.id, 10)
  assert.deepEqual(
    { ...d1.sqlite.prepare('SELECT time_zone, weekday_allowance_minutes, weekend_allowance_minutes, safety_cap_minutes FROM child_time_settings WHERE child_id = ?').get(recreated.id) },
    { time_zone: 'America/Los_Angeles', weekday_allowance_minutes: 60, weekend_allowance_minutes: 120, safety_cap_minutes: 180 },
  )
  assert.equal((d1.sqlite.prepare('SELECT COUNT(*) AS count FROM daily_usage_summaries WHERE child_id = ?').get(recreated.id) as { count: number }).count, 0)
  assert.equal((d1.sqlite.prepare('SELECT COUNT(*) AS count FROM allowed_channels WHERE child_id = ?').get(recreated.id) as { count: number }).count, 0)
})
