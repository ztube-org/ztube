import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from './app.ts'
import { IsolatedD1, migrate } from './test-support/d1.ts'
import { pruneEpisodeClaims } from './modules/episode-claims.ts'
import { readFile, readdir } from 'node:fs/promises'

async function fixture() {
  const d1 = new IsolatedD1()
  await migrate(d1)
  d1.sqlite.exec(`
    INSERT INTO children (id, email) VALUES (1, 'child@example.com'), (2, 'other@example.com');
    INSERT INTO child_time_settings (child_id, time_zone) VALUES (1, 'America/Los_Angeles'), (2, 'America/Los_Angeles');
    INSERT INTO allowed_playlists (id, child_id, playlist_id, playlist_title, cartoon_pool) VALUES
      (10, 1, 'cartoons', 'Cartoons', 1), (11, 1, 'more', 'More cartoons', 1), (20, 2, 'cartoons', 'Cartoons', 1);
    INSERT INTO playlist_videos (playlist_id, video_id, video_title, duration) VALUES
      ('cartoons', 'ep1', 'Episode 1', 600), ('cartoons', 'ep2', 'Episode 2', 600),
      ('more', 'ep3', 'Episode 3', 600), ('more', 'ep1', 'Episode 1', 600),
      ('cartoons', 'short', 'Short', 120);
    INSERT INTO allowed_videos (child_id, video_id, video_title, duration) VALUES
      (1, 'regular', 'Regular video', 600), (1, 'ep1', 'Episode 1', 600);
  `)
  let instant = new Date('2026-09-17T19:00:00Z')
  let childId = 1
  let role: 'admin' | 'non-admin' = 'non-admin'
  const app = createApp({ now: () => instant, resolveUser: async () => ({ id: childId, email: 'child@example.com', displayName: null, avatarUrl: null, role }) })
  const binding = d1 as unknown as D1Database
  const env = { DB: binding } as Env
  const request = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => app.request(path, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }, env)
  return {
    d1, binding, request,
    time: (value: string) => { instant = new Date(value) },
    child: (id: number) => { childId = id },
    admin: () => { role = 'admin' },
    claim: (videoId: string, viewingDay = '2026-09-17') => request('/api/child/episode-claims', { videoId, viewingDay, confirmed: true }),
    authorize: (videoId: string) => request('/api/child/playback-authorizations', { videoId }),
    count: () => Number(d1.sqlite.prepare('SELECT COUNT(*) AS count FROM episode_claims').get()?.count),
  }
}

test('browsing and opening an episode do not claim it; explicit confirmation is required across every entry route', async () => {
  const f = await fixture()
  const pool = await (await f.request('/api/child/cartoon-pool')).json() as any
  assert.deepEqual(pool.videos.map((v: any) => v.videoId), ['ep1', 'ep2', 'ep3'])
  assert.equal(pool.remaining, 1)
  const blocked = await f.authorize('ep1') // Also approved as an individual video.
  assert.equal(blocked.status, 409)
  assert.equal((await blocked.json() as any).code, 'episode-claim-required')
  assert.equal(f.count(), 0)
  assert.equal((await f.request('/api/child/episode-claims', { videoId: 'ep1', viewingDay: '2026-09-17' })).status, 400)
  assert.equal((await f.request('/api/child/episode-claims', { videoId: 'ep1', viewingDay: '2026-09-17', confirmed: false })).status, 400)
  assert.equal((await f.claim('regular')).status, 403)
  assert.equal((await f.claim('short')).status, 403)
  assert.equal((await f.claim('unapproved')).status, 403)
  assert.equal(f.count(), 0)
  assert.equal((await f.authorize('regular')).status, 200)
  assert.equal((await f.claim('ep1')).status, 200)
  assert.equal((await f.claim('ep1')).status, 200)
  assert.equal((await f.authorize('ep1')).status, 200)
  assert.equal((await f.authorize('ep1')).status, 200)
  assert.equal(f.count(), 1)
  assert.equal((await f.claim('ep3')).status, 409, 'all pooled Playlists share the daily limit')
  assert.equal((await f.request('/api/child/episode-claims', { videoId: 'ep1' }, 'DELETE')).status, 404)
  f.child(2)
  assert.equal((await f.claim('ep2')).status, 200, 'siblings have independent claims')
})

test('simultaneous distinct and repeated claims cannot exceed one or two daily slots', async () => {
  const f = await fixture()
  const responses = await Promise.all([f.claim('ep1'), f.claim('ep2'), f.claim('ep3')])
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409, 409])
  assert.equal(f.count(), 1)
  f.d1.sqlite.exec('DELETE FROM episode_claims; DELETE FROM episode_unlocks; INSERT INTO child_episode_settings (child_id, daily_limit) VALUES (1, 2)')
  const two = await Promise.all([f.claim('ep1'), f.claim('ep1'), f.claim('ep2'), f.claim('ep3')])
  assert.deepEqual(two.map(r => r.status).sort(), [200, 200, 200, 409])
  assert.equal(f.count(), 2)
})

test('only Admin can configure a Child’s approved pool, with a daily limit of one or two', async () => {
  const f = await fixture()
  const path = '/api/admin/children/1/cartoon-pool'
  assert.equal((await f.request(path)).status, 403)
  assert.equal((await f.request(path, { dailyLimit: 2, playlistIds: [10] }, 'PUT')).status, 403)
  f.admin()
  assert.equal((await f.request(path, { dailyLimit: 3, playlistIds: [10] }, 'PUT')).status, 400)
  assert.equal((await f.request(path, { dailyLimit: 2, playlistIds: [20] }, 'PUT')).status, 400)
  assert.equal((await f.request('/api/admin/children/999/cartoon-pool')).status, 404)
  assert.equal((await f.request(path, { dailyLimit: 2, playlistIds: [10] }, 'PUT')).status, 200)
  assert.deepEqual(await (await f.request(path)).json(), { dailyLimit: 2, timePoolId: 'pool:1:cartoon', cartoonAllowanceMinutes: 30, playlistIds: [10] })
  assert.equal((await f.authorize('ep3')).status, 200, 'unselected content keeps normal playback')
  assert.equal((await f.authorize('ep1')).status, 409)
  assert.equal((await f.claim('ep1')).status, 200)
  assert.equal((await f.claim('ep2')).status, 200)
  await f.request(path, { dailyLimit: 1, playlistIds: [10] }, 'PUT')
  assert.equal((await f.authorize('ep2')).status, 200, 'reducing future claims retains today’s confirmed choices')
  const status = await (await f.request('/api/child/cartoon-pool')).json() as any
  assert.equal(status.remaining, 0)
})

test('unlocks survive midnight and playback continues against the new day’s limits', async () => {
  const f = await fixture()
  f.time('2026-09-18T06:59:50Z')
  assert.equal((await f.claim('ep1')).status, 200)
  const { authorization } = await (await f.authorize('ep1')).json() as any
  assert.equal(authorization.leaseExpiresAt, '2026-09-18T07:00:50.000Z')
  const heartbeat = (sequence: number) => f.request(`/api/child/playback-authorizations/${authorization.sessionId}/heartbeats`, { sequence, state: 'playing', positionSeconds: 40 })
  await heartbeat(1)
  f.time('2026-09-18T06:59:55Z')
  assert.equal((await (await heartbeat(2)).json() as any).leaseExpiresAt, '2026-09-18T07:00:55.000Z')
  f.time('2026-09-18T07:00:01Z')
  assert.equal((await (await heartbeat(3)).json() as any).authorized, true)
  assert.equal((await f.authorize('ep1')).status, 200)
  assert.equal((await f.claim('ep2', '2026-09-17')).status, 409, 'stale confirmation must not spend today’s slot')
  const pool = await (await f.request('/api/child/cartoon-pool')).json() as any
  assert.equal(pool.viewingDay, '2026-09-18')
  assert.equal(pool.remaining, 1)
  assert.deepEqual(pool.claimedVideos, [])
  assert.deepEqual(pool.unlockedVideoIds, ['ep1'])
  assert.equal((await f.claim('ep2', '2026-09-18')).status, 200)
  assert.equal(f.d1.sqlite.prepare("SELECT cartoon_seconds FROM daily_usage_summaries WHERE child_id = 1 AND viewing_day = '2026-09-17'").get()?.cartoon_seconds, 10)
  await pruneEpisodeClaims(f.binding, new Date('2026-09-18T07:00:01Z'))
  assert.equal(f.count(), 1)
  f.d1.sqlite.exec('DELETE FROM children WHERE id = 1')
  assert.equal(f.count(), 0)
})

test('claims do not override viewing allowances, approval revocation or a disabled WebDAV Provider', async () => {
  const f = await fixture()
  await f.claim('ep1')
  f.d1.sqlite.exec('UPDATE child_time_settings SET cartoon_allowance_minutes = 0 WHERE child_id = 1')
  assert.equal((await f.authorize('ep1')).status, 403)
  f.d1.sqlite.exec("DELETE FROM allowed_videos WHERE video_id = 'ep1'; DELETE FROM allowed_playlists WHERE child_id = 1")
  assert.equal((await f.authorize('ep1')).status, 403)
  f.d1.sqlite.exec(`
    INSERT INTO media_providers (id, name, url, credentials, enabled) VALUES ('dav', 'DAV', 'https://dav.example', 'sealed', 0);
    INSERT INTO provider_media (video_id, provider_id, path) VALUES ('ol:episode', 'dav', '/episode.mp4');
    INSERT INTO allowed_playlists (id, child_id, playlist_id, playlist_title, cartoon_pool) VALUES (12, 1, 'webdav', 'WebDAV', 1);
    INSERT INTO playlist_videos (playlist_id, video_id, video_title, duration) VALUES ('webdav', 'ol:episode', 'Episode', 600);
  `)
  assert.equal((await f.claim('ol:episode')).status, 403)
})

test('WebDAV media resolution and existing playback require a claim when the Admin adds a Playlist to the pool', async () => {
  const f = await fixture()
  f.d1.sqlite.exec(`
    INSERT INTO media_providers (id, name, url, credentials, enabled) VALUES ('dav', 'DAV', 'https://dav.example', 'sealed', 1);
    INSERT INTO provider_media (video_id, provider_id, path) VALUES ('ol:episode', 'dav', '/episode.mp4');
    INSERT INTO allowed_playlists (id, child_id, playlist_id, playlist_title) VALUES (12, 1, 'webdav', 'WebDAV');
    INSERT INTO playlist_videos (playlist_id, video_id, video_title, duration) VALUES ('webdav', 'ol:episode', 'Episode', 600);
  `)
  const { authorization } = await (await f.authorize('ol:episode')).json() as any
  f.d1.sqlite.exec('UPDATE allowed_playlists SET cartoon_pool = 1 WHERE id = 12')
  const media = await f.request(`/api/child/playback-authorizations/${authorization.sessionId}/media`)
  assert.equal(media.status, 403)
  assert.match((await media.json() as any).message, /no longer approved|Claim this episode/)
  const heartbeat = await f.request(`/api/child/playback-authorizations/${authorization.sessionId}/heartbeats`, { sequence: 1, state: 'playing' })
  assert.equal((await heartbeat.json() as any).authorized, false)
})

test('Cartoon Time is independent of ordinary and exempt balances, counts replays, and stops at its own cap', async () => {
  const f = await fixture()
  f.d1.sqlite.exec(`
    UPDATE child_time_settings SET weekday_allowance_minutes = 0, safety_cap_minutes = 0, cartoon_allowance_minutes = 1 WHERE child_id = 1;
    UPDATE allowed_videos SET content_rule = 'exempt' WHERE video_id = 'ep1';
  `)
  await f.claim('ep1')
  assert.equal((await f.authorize('regular')).status, 403)
  const first = await (await f.authorize('ep1')).json() as any
  assert.equal(first.authorization.usageBucket, 'cartoon', 'pool membership overrides even an individual exempt rule')
  assert.equal(first.authorization.remainingSeconds, 60)
  const beat = (sessionId: string, sequence: number, state = 'playing') => f.request(`/api/child/playback-authorizations/${sessionId}/heartbeats`, { sequence, state, positionSeconds: 0 })
  await beat(first.authorization.sessionId, 1)
  f.time('2026-09-17T19:00:20Z')
  await beat(first.authorization.sessionId, 2, 'paused')
  f.time('2026-09-17T19:00:40Z')
  const replay = await (await f.authorize('ep1')).json() as any
  assert.equal(replay.authorization.remainingSeconds, 40, 'pausing did not spend Cartoon Time')
  await beat(replay.authorization.sessionId, 1)
  f.time('2026-09-17T19:01:30Z')
  const exhausted = await (await beat(replay.authorization.sessionId, 2)).json() as any
  assert.equal(exhausted.authorized, false)
  assert.equal(exhausted.remainingSeconds, 0)
  const usage = f.d1.sqlite.prepare('SELECT cartoon_seconds, restricted_seconds, exempt_seconds FROM daily_usage_summaries WHERE child_id = 1').get()
  assert.deepEqual({ ...usage }, { cartoon_seconds: 60, restricted_seconds: 0, exempt_seconds: 0 })
  const blocked = await f.authorize('ep1')
  assert.equal(blocked.status, 403)
  assert.match((await blocked.json() as any).message, /Cartoons time is used up/)
  f.d1.sqlite.exec('UPDATE child_time_settings SET weekday_allowance_minutes = 60 WHERE child_id = 1')
  assert.equal((await f.authorize('regular')).status, 200, 'ordinary minutes remain available after Cartoon Time is exhausted')
  f.admin()
  const summary = await (await f.request('/api/admin/children/1/usage?days=7')).json() as any
  assert.equal(summary.days.at(-1).cartoonSeconds, 60)
  assert.equal(summary.days.at(-1).totalSeconds, 60)
  const events = await (await f.request('/api/admin/children/1/viewing-events')).json() as any
  assert.ok(events.events.every((event: any) => event.usageBucket === 'cartoon'))
})

test('changing Cartoon Time settles active use and cannot reset consumption or change the ordinary allowance', async () => {
  const f = await fixture()
  f.admin()
  const path = '/api/admin/children/1/cartoon-pool'
  for (const minutes of [-1, 1.5, 1441]) assert.equal((await f.request(path, { dailyLimit: 1, playlistIds: [10], cartoonAllowanceMinutes: minutes }, 'PUT')).status, 400)
  await f.claim('ep1')
  const { authorization } = await (await f.authorize('ep1')).json() as any
  await f.request(`/api/child/playback-authorizations/${authorization.sessionId}/heartbeats`, { sequence: 1, state: 'playing' })
  f.time('2026-09-17T19:00:20Z')
  assert.equal((await f.request(path, { dailyLimit: 1, playlistIds: [10], cartoonAllowanceMinutes: 0 }, 'PUT')).status, 200)
  assert.equal((await f.authorize('ep1')).status, 403)
  await f.request(path, { dailyLimit: 1, playlistIds: [10], cartoonAllowanceMinutes: 1 }, 'PUT')
  assert.equal((await (await f.authorize('ep1')).json() as any).authorization.remainingSeconds, 40)
  const settings = f.d1.sqlite.prepare('SELECT weekday_allowance_minutes, cartoon_allowance_minutes FROM child_time_settings WHERE child_id = 1').get()
  assert.deepEqual({ ...settings }, { weekday_allowance_minutes: 60, cartoon_allowance_minutes: 1 })
})

test('the Cartoon Time migration preserves existing sessions, viewing events and foreign-key cascades', async () => {
  const d1 = new IsolatedD1()
  const directory = new URL('../migrations/', import.meta.url)
  for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql') && name < '0022').sort()) await d1.exec(await readFile(new URL(name, directory), 'utf8'))
  d1.sqlite.exec(`
    INSERT INTO children (id, email) VALUES (1, 'migration@example.com');
    INSERT INTO child_time_settings (child_id) VALUES (1);
    INSERT INTO playback_sessions (id, child_id, viewing_day, last_acknowledged_at, lease_expires_at, usage_bucket, video_id) VALUES ('old', 1, '2026-09-17', 10, 70, 'exempt', 'ep');
    INSERT INTO viewing_events (session_id, child_id, video_id, video_title, usage_bucket, authorized_at, watched_seconds) VALUES ('old', 1, 'ep', 'Episode', 'exempt', 10, 20);
  `)
  await d1.exec(await readFile(new URL('0022_cartoon_watch_time.sql', directory), 'utf8'))
  assert.equal(d1.sqlite.prepare('SELECT watched_seconds FROM viewing_events').get()?.watched_seconds, 20)
  assert.equal(d1.sqlite.prepare('SELECT usage_bucket FROM playback_sessions').get()?.usage_bucket, 'exempt')
  assert.equal(d1.sqlite.prepare('SELECT cartoon_allowance_minutes FROM child_time_settings').get()?.cartoon_allowance_minutes, 30)
  assert.deepEqual(d1.sqlite.prepare('PRAGMA foreign_key_check').all(), [])
  d1.sqlite.exec("UPDATE playback_sessions SET usage_bucket = 'cartoon'; UPDATE viewing_events SET usage_bucket = 'cartoon'; DELETE FROM children WHERE id = 1")
  assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS count FROM viewing_events').get()?.count, 0)
  assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS count FROM playback_sessions').get()?.count, 0)
})

test('the permanent unlock migration recovers retained claims and cartoon playback', async () => {
  const d1 = new IsolatedD1()
  const directory = new URL('../migrations/', import.meta.url)
  try {
    for (const name of (await readdir(directory)).filter(name => name.endsWith('.sql') && name < '0025').sort()) await d1.exec(await readFile(new URL(name, directory), 'utf8'))
    d1.sqlite.exec(`
      INSERT INTO children (id, email) VALUES (1, 'migration@example.com');
      INSERT INTO child_time_settings (child_id) VALUES (1);
      INSERT INTO episode_claims (child_id, viewing_day, video_id, claimed_at) VALUES (1, '2026-09-17', 'claimed', 100);
      INSERT INTO playback_sessions (id, child_id, viewing_day, last_acknowledged_at, lease_expires_at, usage_bucket, video_id) VALUES ('watched', 1, '2026-09-16', 110, 170, 'cartoon', 'watched');
      INSERT INTO viewing_events (session_id, child_id, video_id, video_title, usage_bucket, authorized_at, watched_seconds) VALUES ('watched', 1, 'watched', 'Watched episode', 'cartoon', 110, 20);
    `)
    await d1.exec(await readFile(new URL('0025_permanent_episode_unlocks.sql', directory), 'utf8'))
    assert.deepEqual(d1.sqlite.prepare('SELECT video_id FROM episode_unlocks ORDER BY video_id').all().map(row => row.video_id), ['claimed', 'watched'])
    d1.sqlite.exec("INSERT INTO episode_claims (child_id, viewing_day, video_id, claimed_at) VALUES (1, '2026-09-18', 'new', 200)")
    assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM episode_unlocks WHERE video_id = 'new'").get()?.count, 1)
    d1.sqlite.exec("DELETE FROM episode_claims; DELETE FROM children WHERE id = 1")
    assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS count FROM episode_unlocks').get()?.count, 0)
  } finally { d1.sqlite.close() }
})

test('replaying or reclaiming an unlocked video never consumes a new daily credit', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.claim('ep1')).status, 200)
    f.time('2026-09-18T19:00:00Z')
    await pruneEpisodeClaims(f.binding, new Date('2026-09-18T19:00:00Z'))
    assert.equal((await f.authorize('ep1')).status, 200)
    assert.equal((await f.claim('ep1', '2026-09-17')).status, 200, 'retrying an existing unlock is harmless even after midnight')
    assert.equal(f.count(), 0)
    const before = await (await f.request('/api/child/cartoon-pool')).json() as any
    assert.equal(before.remaining, 1)
    assert.equal((await f.claim('ep2', '2026-09-18')).status, 200)
    assert.equal((await f.claim('ep3', '2026-09-18')).status, 409)
    assert.equal((await f.authorize('ep1')).status, 200)
    f.child(2)
    assert.equal((await f.authorize('ep1')).status, 409)
  } finally { f.d1.sqlite.close() }
})

test('Admin grants today-only credits without changing recurring limits, unlocks or Watch Time', async () => {
  const f = await fixture()
  try {
    const path = '/api/admin/children/1/unlock-credits'
    const grant = { requestId: crypto.randomUUID(), viewingDay: '2026-09-17' }
    assert.equal((await f.request(path)).status, 403)
    assert.equal((await f.request(path, grant)).status, 403)
    await f.claim('ep1')
    assert.equal((await f.claim('ep2')).status, 409)
    f.admin()
    assert.equal((await f.request('/api/admin/children/999/unlock-credits', grant)).status, 404)
    for (const invalid of [{}, { ...grant, requestId: 'invalid' }, { ...grant, viewingDay: 'yesterday' }]) assert.equal((await f.request(path, invalid)).status, 400)
    const granted = await f.request(path, grant)
    assert.equal(granted.status, 200)
    const status = await granted.json() as any
    assert.equal(status.dailyLimit, 1); assert.equal(status.totalCredits, 2)
    assert.equal(status.bonusCredits, 1); assert.equal(status.remaining, 1)
    assert.equal((await f.claim('ep2')).status, 200)
    assert.equal((await f.claim('ep3')).status, 409)
    assert.equal((await (await f.request('/api/child/cartoon-pool')).json() as any).remaining, 0)
    assert.equal(f.d1.sqlite.prepare('SELECT COUNT(*) AS n FROM episode_unlocks WHERE child_id = 1').get()?.n, 2)
    assert.equal(f.d1.sqlite.prepare('SELECT COUNT(*) AS n FROM child_episode_settings').get()?.n, 0, 'default recurring allowance stays unchanged')
    f.d1.sqlite.exec("UPDATE time_pools SET weekday_minutes = 0, weekend_minutes = 0 WHERE id = 'pool:1:cartoon'")
    assert.equal((await f.authorize('ep2')).status, 403, 'extra credits do not grant Watch Time')
    f.child(2)
    assert.equal((await (await f.request('/api/child/cartoon-pool')).json() as any).totalCredits, 1)
  } finally { f.d1.sqlite.close() }
})

test('retried and concurrent grants are idempotent while racing claims share the extended allowance', async () => {
  const f = await fixture()
  try {
    f.admin()
    const path = '/api/admin/children/1/unlock-credits'
    const grant = { requestId: crypto.randomUUID(), viewingDay: '2026-09-17' }
    const responses = await Promise.all([f.request(path, grant), f.request(path, grant), f.request(path, grant)])
    assert.ok(responses.every(r => r.status === 200))
    assert.equal(f.d1.sqlite.prepare('SELECT COUNT(*) AS n FROM episode_credit_grants').get()?.n, 1)
    const claims = await Promise.all([f.claim('ep1'), f.claim('ep2'), f.claim('ep3')])
    assert.deepEqual(claims.map(r => r.status).sort(), [200, 200, 409])
    assert.equal(f.count(), 2)
    assert.equal((await (await f.request(path, grant)).json() as any).remaining, 0, 'retry after spending the credit cannot restore it')
    assert.equal((await (await f.request(path, { ...grant, requestId: crypto.randomUUID() })).json() as any).remaining, 1, 'another intentional grant adds one credit')
  } finally { f.d1.sqlite.close() }
})

test('temporary credits expire at Child local midnight even without pruning and stale grants cannot spill into tomorrow', async () => {
  const f = await fixture()
  try {
    f.admin()
    f.time('2026-09-18T06:59:50Z') // Still September 17 in Los Angeles.
    const path = '/api/admin/children/1/unlock-credits'
    const grant = { requestId: crypto.randomUUID(), viewingDay: '2026-09-17' }
    await f.request(path, grant)
    assert.equal((await f.claim('ep1')).status, 200)
    await f.request('/api/admin/children/2/unlock-credits', { ...grant, requestId: crypto.randomUUID() })
    f.time('2026-09-18T07:00:01Z')
    const next = await (await f.request(path)).json() as any
    assert.equal(next.viewingDay, '2026-09-18'); assert.equal(next.totalCredits, 1); assert.equal(next.remaining, 1); assert.equal(next.bonusCredits, 0)
    assert.equal((await f.request(path, grant)).status, 409)
    assert.equal((await f.authorize('ep1')).status, 200, 'yesterday’s permanent unlock survives credit expiry')
    assert.equal((await f.claim('ep2', '2026-09-18')).status, 200)
    assert.equal((await f.claim('ep3', '2026-09-18')).status, 409)
    await pruneEpisodeClaims(f.binding, new Date('2026-09-18T07:00:01Z'))
    assert.equal(f.d1.sqlite.prepare('SELECT COUNT(*) AS n FROM episode_credit_grants').get()?.n, 0, 'also prunes grants for a Child who never claimed')
    assert.equal(f.d1.sqlite.prepare('SELECT COUNT(*) AS n FROM episode_unlocks').get()?.n, 2)
  } finally { f.d1.sqlite.close() }
})
