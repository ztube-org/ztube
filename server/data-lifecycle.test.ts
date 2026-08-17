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
    '0008_two-role_accounts.sql',
    '0009_video_classifications.sql',
    '0010_drop_video_classifications.sql',
    '0011_video_published_at.sql',
    '0012_favorites_and_playback_progress.sql',
    '0013_video_recommendations.sql',
    '0014_video_descriptions.sql',
  ]) await d1.exec(await readFile(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'))
  d1.sqlite.exec(`
    INSERT INTO children (id, email) VALUES (10, 'child@example.com'), (20, 'other-child@example.com');
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
    resolveUser: async () => ({ id: 1, email: 'parent@example.com', displayName: null, role: 'admin' }),
  })
  const env = { DB: d1 as unknown as D1Database } as Env
  const request = (path: string, method = 'GET', body?: unknown) => app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env)
  return { d1, request }
}

test('every signed-in account gets a Child profile and configured accounts also get Admin access', async () => {
  const { d1 } = await fixture()
  const app = createApp()
  const env = {
    DB: d1 as unknown as D1Database,
    AUTH_MODE: 'local',
    ADMIN_EMAILS: 'admin@example.com, second-admin@example.com',
    LOCAL_DEV_USER_EMAIL: 'new-child@example.com',
  } as Env

  const childResponse = await app.request('/api/auth/session', {}, env)
  assert.equal(childResponse.status, 200)
  const child = (await childResponse.json() as any).user
  assert.equal(child.role, 'non-admin')
  assert.equal(child.email, 'new-child@example.com')
  assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS count FROM children WHERE email = ?').get(child.email)?.count, 1)
  assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS count FROM child_time_settings WHERE child_id = ?').get(child.id)?.count, 1)

  env.LOCAL_DEV_USER_EMAIL = 'admin@example.com'
  const admin = (await (await app.request('/api/auth/session', {}, env)).json() as any).user
  assert.equal(admin.role, 'admin')
  assert.equal(admin.email, 'admin@example.com')
  assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS count FROM children WHERE id = ?').get(admin.id)?.count, 1)
  assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS count FROM child_time_settings WHERE child_id = ?').get(admin.id)?.count, 1)

  env.LOCAL_DEV_USER_EMAIL = 'second-admin@example.com'
  const secondAdmin = (await (await app.request('/api/auth/session', {}, env)).json() as any).user
  assert.equal(secondAdmin.role, 'admin')
  assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS count FROM children WHERE id = ?').get(secondAdmin.id)?.count, 1)

  const accounts = (await (await app.request('/api/admin/children', {}, env)).json() as any).children
  assert.equal(accounts.find((account: any) => account.id === admin.id).isAdmin, true)
  assert.equal(accounts.find((account: any) => account.id === child.id).isAdmin, false)
})

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

  const today = await (await request('/api/admin/children/10/watch-time')).json() as any
  assert.equal(today.viewingDay, '2026-08-16')
  assert.equal(today.restricted.usedSeconds, 240)
  assert.equal(today.exempt.usedSeconds, 60)
  assert.equal('history' in today, false)
})

test('accounts cannot be manually created or deleted through Admin APIs', async () => {
  const { request } = await fixture()
  assert.equal((await request('/api/admin/children', 'POST', { email: 'manual@example.com' })).status, 404)
  assert.equal((await request('/api/admin/children/10', 'DELETE')).status, 404)
})
