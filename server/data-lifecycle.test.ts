import assert from 'node:assert/strict'
import { IsolatedD1, migrate } from './test-support/d1.ts'
import test from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { createApp } from './app.ts'
import { expirePlaybackSessions } from './utils/playback-retention.ts'

async function fixture() {
  const d1 = new IsolatedD1()
  await migrate(d1)
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

test('expired Playback Authorization cannot retain a video identity', async () => {
  const { d1 } = await fixture()
  d1.sqlite.exec("UPDATE playback_sessions SET video_id = 'temporary-video' WHERE id = 'session'")
  assert.equal(await expirePlaybackSessions({ DB: d1 as unknown as D1Database }, new Date('2026-08-16T19:01:01Z')), 1)
  assert.deepEqual(
    { ...(d1.sqlite.prepare("SELECT last_state, ended_at, video_id FROM playback_sessions WHERE id = 'session'").get() as object) },
    { last_state: 'ended', ended_at: 1786906860, video_id: null },
  )
})

test('accounts cannot be manually created or deleted through Admin APIs', async () => {
  const { request } = await fixture()
  assert.equal((await request('/api/admin/children', 'POST', { email: 'manual@example.com' })).status, 404)
  assert.equal((await request('/api/admin/children/10', 'DELETE')).status, 404)
})

test('migration 0029 retires WebDAV content while preserving Jellyfin, YouTube and viewing history', async t => {
  const d1 = new IsolatedD1()
  t.after(() => d1.sqlite.close())
  const directory = new URL('../migrations/', import.meta.url)
  const retirement = '0029_drop_webdav_providers.sql'
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql') && name < retirement).sort()) {
    d1.sqlite.exec(await readFile(new URL(name, directory), 'utf8'))
  }
  d1.sqlite.exec(`
    INSERT INTO children (id, email) VALUES (1, 'migration@example.com');
    INSERT INTO media_providers (id, name, url, credentials) VALUES ('retired', 'Retired', 'https://dav.example.com', 'sealed');
    INSERT INTO provider_media (video_id, provider_id, path) VALUES ('ol:episode', 'retired', '/episode.mp4');
    INSERT INTO jellyfin_servers (id, name, url, credentials) VALUES ('home', 'Jellyfin', 'https://jellyfin.example.com', 'sealed');
    INSERT INTO curated_playlists (id, title) VALUES ('pl:archive', 'Archived'), ('pl:jf:series', 'Jellyfin');
    INSERT INTO jellyfin_imports (playlist_id, server_id, item_id, last_synced_at) VALUES ('pl:jf:series', 'home', 'series', 10);
    INSERT INTO jellyfin_media (video_id, server_id, item_id, media_source_id) VALUES ('jf:episode', 'home', 'episode', 'source');
    INSERT INTO allowed_playlists (child_id, playlist_id, playlist_title, cartoon_pool) VALUES
      (1, 'pl:archive', 'Archived', 1), (1, 'pl:jf:series', 'Jellyfin', 1), (1, 'PLyoutube', 'YouTube', 0);
    INSERT INTO playlist_videos (playlist_id, video_id, video_title) VALUES
      ('pl:archive', 'ol:episode', 'Archived episode'), ('pl:jf:series', 'jf:episode', 'Jellyfin episode'), ('PLyoutube', 'youtube', 'YouTube video');
    INSERT INTO time_pool_bindings VALUES (1, 'playlist', 'pl:archive', 'pool:1:cartoon'), (1, 'playlist', 'pl:jf:series', 'pool:1:cartoon'), (1, 'video', 'ol:episode', 'pool:1:cartoon');
    INSERT INTO favorite_videos (child_id, video_id) VALUES (1, 'ol:episode'), (1, 'jf:episode');
    INSERT INTO playback_progress (child_id, video_id, position_seconds, duration, video_title) VALUES
      (1, 'ol:episode', 90, 600, 'Archived episode'), (1, 'jf:episode', 90, 600, 'Jellyfin episode');
    INSERT INTO playback_sessions (id, child_id, viewing_day, last_state, last_acknowledged_at, lease_expires_at, video_id)
      VALUES ('old', 1, '2026-08-16', 'playing', 20, 50, 'ol:episode');
    INSERT INTO viewing_events (session_id, child_id, video_id, video_title, usage_bucket, authorized_at, watched_seconds)
      VALUES ('old', 1, 'ol:episode', 'Archived episode', 'cartoon', 10, 10);
    INSERT INTO episode_claims (child_id, viewing_day, video_id, claimed_at) VALUES (1, '2026-08-16', 'ol:episode', 10);
    INSERT INTO daily_usage_summaries (child_id, viewing_day, cartoon_seconds) VALUES (1, '2026-08-16', 10);
  `)
  d1.sqlite.exec(await readFile(new URL(retirement, directory), 'utf8'))

  const values = (query: string) => d1.sqlite.prepare(query).all().map(row => Object.values(row)[0])
  assert.deepEqual(values("SELECT name FROM sqlite_schema WHERE name IN ('provider_media', 'media_providers')"), [])
  assert.deepEqual(values('SELECT id FROM curated_playlists'), ['pl:jf:series'])
  assert.deepEqual(values('SELECT playlist_id FROM jellyfin_imports'), ['pl:jf:series'])
  assert.deepEqual(values('SELECT playlist_id FROM allowed_playlists ORDER BY playlist_id'), ['PLyoutube', 'pl:jf:series'])
  assert.deepEqual(values('SELECT video_id FROM playlist_videos ORDER BY video_id'), ['jf:episode', 'youtube'])
  assert.deepEqual(values('SELECT content_id FROM time_pool_bindings'), ['pl:jf:series'])
  assert.deepEqual(values('SELECT video_id FROM favorite_videos'), ['jf:episode'])
  assert.deepEqual(values('SELECT video_id FROM playback_progress'), ['jf:episode'])
  assert.deepEqual({ ...d1.sqlite.prepare("SELECT last_state, ended_at, video_id FROM playback_sessions WHERE id = 'old'").get() },
    { last_state: 'ended', ended_at: 20, video_id: null })
  assert.deepEqual(values('SELECT watched_seconds FROM viewing_events'), [10])
  assert.deepEqual(values('SELECT cartoon_seconds FROM daily_usage_summaries'), [10])
  assert.deepEqual(values('SELECT video_id FROM episode_claims'), ['ol:episode'])
  assert.deepEqual(d1.sqlite.prepare('PRAGMA foreign_key_check').all(), [])
})
