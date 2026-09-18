import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from './app.ts'
import { IsolatedD1, migrate } from './test-support/d1.ts'
import { syncApprovedContent } from './utils/content-sync.ts'
import { expirePlaybackSessions } from './utils/playback-retention.ts'
import { createPlaybackReporter } from '../src/youtube-player.ts'

async function fixture() {
  const d1 = new IsolatedD1()
  await migrate(d1)
  d1.sqlite.exec(`
    INSERT INTO children (id, email) VALUES (10, 'child@example.com');
    INSERT INTO child_time_settings (child_id, time_zone, weekday_allowance_minutes, weekend_allowance_minutes) VALUES (10, 'UTC', 15, 15);
    INSERT INTO allowed_videos (child_id, video_id, video_title, is_available) VALUES (10, 'approved', 'Approved', 1);
  `)
  const clock = new Date('2026-08-17T12:00:00.000Z')
  const app = createApp({ now: () => new Date(clock), resolveUser: async () => ({ id: 10, email: 'child@example.com', displayName: null, role: 'admin' }) })
  const env = { DB: d1 as unknown as D1Database } as Env
  const post = (path: string, body: unknown) => app.request(path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, env)
  const authorize = async () => (await (await post('/api/child/playback-authorizations', { videoId: 'approved' })).json() as any).authorization
  const heartbeat = (id: string, sequence: number, state = 'playing') => post(`/api/child/playback-authorizations/${id}/heartbeats`, { sequence, state })
  return { d1, clock, authorize, heartbeat, request: (path: string, method: string, body?: unknown) => app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env) }
}

test('the reporter stops on takeover denial even when the server returns an older sequence', async t => {
  const { authorize, heartbeat } = await fixture()
  const active = await authorize()
  let paused = 0
  let blocked = 0
  let response!: Promise<{ sequence: number; remainingSeconds: number; authorized: boolean }>
  const reporter = createPlaybackReporter({
    initialRemainingSeconds: active.remainingSeconds,
    document: { hidden: false, pictureInPictureElement: null, addEventListener() {}, removeEventListener() {} },
    pause: () => { paused++ },
    onBlocked: () => { blocked++ },
    onRemaining() {},
    heartbeat(sequence, state) {
      response = heartbeat(active.sessionId, sequence, state).then(result => result.json())
      return response
    },
  })
  t.after(() => reporter.stop())
  reporter.setState('playing')
  await response
  await new Promise(resolve => setImmediate(resolve))
  await authorize()
  reporter.setState('playing')
  const denied = await response
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(denied.authorized, false)
  assert.equal(denied.sequence, 1, 'ended session retains its last accepted sequence')
  assert.equal(paused, 1, 'stop on the denial rather than waiting for lease expiry')
  assert.equal(blocked, 1, 'notify the watch page to remove the player')
  reporter.setState('playing')
  assert.equal(paused, 2, 'a blocked player cannot restart')
})

test('switching videos must settle the previous active interval', async () => {
 const { d1, clock, authorize, heartbeat } = await fixture()
 for (let i = 0; i < 64; i++) {
   const auth = await authorize()
   assert.ok(auth, 'session remains authorized')
   await heartbeat(auth.sessionId, 1)
   clock.setTime(clock.getTime() + 14_000)
 }
 await authorize()
 const used = Number(d1.sqlite.prepare('SELECT COALESCE(SUM(restricted_seconds), 0) AS seconds FROM daily_usage_summaries').get()!.seconds)
 assert.equal(used, 896, `896 seconds played in 64 sessions; recorded ${used} seconds`)
})

test('takeover settles the final seconds before deciding whether to authorize', async () => {
  const { d1, clock, authorize, heartbeat } = await fixture()
  d1.sqlite.exec("INSERT INTO daily_usage_summaries (child_id, viewing_day, restricted_seconds) VALUES (10, '2026-08-17', 896)")
  const active = await authorize()
  await heartbeat(active.sessionId, 1)
  clock.setTime(clock.getTime() + 14_000)
  assert.equal(await authorize(), undefined)
  assert.equal(d1.sqlite.prepare('SELECT restricted_seconds FROM daily_usage_summaries').get()!.restricted_seconds, 900)
  assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS count FROM playback_sessions WHERE ended_at IS NULL').get()!.count, 0)
})

test('racing takeover and heartbeat settle an interval once and leave one active player', async () => {
  const { d1, clock, authorize, heartbeat } = await fixture()
  const active = await authorize()
  await heartbeat(active.sessionId, 1)
  clock.setTime(clock.getTime() + 10_000)
  await Promise.all([authorize(), authorize(), heartbeat(active.sessionId, 2)])
  assert.equal(d1.sqlite.prepare('SELECT restricted_seconds FROM daily_usage_summaries').get()!.restricted_seconds, 10)
  assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS count FROM playback_sessions WHERE ended_at IS NULL').get()!.count, 1)
})

test('scheduled expiration settles only the lease and never double charges', async () => {
  const { d1, clock, authorize, heartbeat } = await fixture()
  const active = await authorize()
  await heartbeat(active.sessionId, 1)
  clock.setTime(clock.getTime() + 120_000)
  const env = { DB: d1 as unknown as D1Database }
  assert.equal(await expirePlaybackSessions(env, clock), 1)
  assert.equal(await expirePlaybackSessions(env, clock), 0)
  assert.equal(d1.sqlite.prepare('SELECT restricted_seconds FROM daily_usage_summaries').get()!.restricted_seconds, 60)
  assert.equal((await (await heartbeat(active.sessionId, 2)).json() as any).authorized, false)
})

test('takeover splits the final interval between Viewing Days', async () => {
  const { d1, clock, authorize, heartbeat } = await fixture()
  clock.setTime(Date.parse('2026-08-17T23:59:50Z'))
  const active = await authorize()
  await heartbeat(active.sessionId, 1)
  clock.setTime(Date.parse('2026-08-18T00:00:04Z'))
  assert.ok(await authorize())
  assert.deepEqual(d1.sqlite.prepare('SELECT viewing_day, restricted_seconds FROM daily_usage_summaries ORDER BY viewing_day').all().map(row => ({ ...row })), [
    { viewing_day: '2026-08-17', restricted_seconds: 10 },
    { viewing_day: '2026-08-18', restricted_seconds: 4 },
  ])
})

test('removing Approved Content must revoke its active lease', async () => {
 const { d1, clock, authorize, heartbeat, request } = await fixture()
 const auth = await authorize()
 await heartbeat(auth.sessionId, 1)
 const id = d1.sqlite.prepare('SELECT id FROM allowed_videos').get()!.id
 assert.equal((await request(`/api/admin/content/${id}?type=video`, 'DELETE')).status, 200)
 clock.setTime(clock.getTime() + 15_000)
 const renewed = await (await heartbeat(auth.sessionId, 2)).json() as any
 assert.equal(renewed.authorized, false, 'removed content is still authorized')
})

test('changing exempt content to restricted must re-evaluate the usage bucket', async () => {
 const { d1, clock, authorize, heartbeat, request } = await fixture()
 d1.sqlite.exec("UPDATE allowed_videos SET content_rule = 'exempt'; INSERT INTO daily_usage_summaries (child_id, viewing_day, restricted_seconds) VALUES (10, '2026-08-17', 900)")
 const auth = await authorize()
 await heartbeat(auth.sessionId, 1)
 const id = d1.sqlite.prepare('SELECT id FROM allowed_videos').get()!.id
 assert.equal((await request(`/api/admin/children/10/content/video/${id}/rule`, 'PUT', {rule: 'restricted'})).status, 200)
 clock.setTime(clock.getTime() + 15_000)
 assert.equal((await (await heartbeat(auth.sessionId, 2)).json() as any).authorized, false)
})

test('restoring the allowance must not reduce recorded watch time', async () => {
 const { d1, clock, authorize, heartbeat, request } = await fixture()
 await request('/api/admin/children/10/watch-time/restricted-unlock', 'PUT', {unlocked: true})
 const auth = await authorize()
 await heartbeat(auth.sessionId, 1)
 for(let i = 2; i <= 81; i++) { clock.setTime(clock.getTime() + 15_000); await heartbeat(auth.sessionId, i) }
 assert.equal(d1.sqlite.prepare('SELECT restricted_seconds FROM daily_usage_summaries').get()!.restricted_seconds, 1200)
 await request('/api/admin/children/10/watch-time/restricted-unlock', 'PUT', {unlocked: false})
 clock.setTime(clock.getTime() + 15_000)
 await heartbeat(auth.sessionId, 82)
 assert.ok(Number(d1.sqlite.prepare('SELECT restricted_seconds FROM daily_usage_summaries').get()!.restricted_seconds) >= 1200, 'restoring 15-minute limit erased five minutes of already recorded usage')
})

test('failed cache replacement must preserve the last complete snapshot', async () => {
 const { d1 } = await fixture()
 d1.sqlite.exec("INSERT INTO allowed_channels (child_id, channel_id, uploads_playlist_id, channel_title) VALUES (10, 'channel', 'uploads', 'Channel'); INSERT INTO channel_videos (channel_id, video_id, video_title, duration) VALUES ('channel', 'old', 'Existing', 600)")
 const priorFetch = globalThis.fetch
 const priorPrepare = d1.prepare.bind(d1)
 globalThis.fetch = async input => {
   const url = new URL(String(input))
   if(url.pathname.endsWith('/channels')) return Response.json({items:[{id:'channel',snippet:{title:'Channel'},contentDetails:{relatedPlaylists:{uploads:'uploads'}}}]})
   if(url.pathname.endsWith('/playlistItems')) return Response.json({items:[{contentDetails:{videoId:'new'},snippet:{title:'New'}}]})
   return Response.json({items:[{id:'new',snippet:{title:'New'},contentDetails:{duration:'PT10M'}}]})
 }
 d1.prepare = (sql: string) => {
   if(sql.toLowerCase().startsWith('insert into "channel_videos"')) return priorPrepare('INSERT INTO missing_table VALUES (1)')
   return priorPrepare(sql)
 }
 try {
   const result = await syncApprovedContent({DB: d1, YOUTUBE_API_KEY:'test-key'} as any, {force:true})
   assert.equal(result.failed, 1)
   assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS count FROM channel_videos').get()!.count, 1, 'cache was deleted before replacement failed')
 } finally { globalThis.fetch = priorFetch }
})

test('Viewing Events retain metadata and count playing intervals exactly once, excluding pauses', async () => {
  const { d1, clock, authorize, heartbeat, request } = await fixture()
  const auth = await authorize()
  const events = async () => (await (await request('/api/admin/children/10/viewing-events', 'GET')).json() as any).events
  assert.deepEqual(await events(), [], 'opening a player is not watching')
  clock.setTime(clock.getTime() + 5_000)
  await heartbeat(auth.sessionId, 1)
  clock.setTime(clock.getTime() + 10_000)
  await Promise.all([heartbeat(auth.sessionId, 2, 'paused'), heartbeat(auth.sessionId, 2, 'paused')])
  clock.setTime(clock.getTime() + 20_000)
  await heartbeat(auth.sessionId, 3)
  clock.setTime(clock.getTime() + 15_000)
  await heartbeat(auth.sessionId, 4, 'ended')
  d1.sqlite.exec("DELETE FROM allowed_videos")
  assert.deepEqual(await events(), [{ sessionId: auth.sessionId, videoId: 'approved', videoTitle: 'Approved', channelTitle: null, usageBucket: 'restricted', timePoolId: 'pool:10:restricted', timePoolName: 'General videos', startedAt: Date.parse('2026-08-17T12:00:05Z') / 1000, lastWatchedAt: Date.parse('2026-08-17T12:00:50Z') / 1000, watchedSeconds: 25, status: 'ended' }])
})

test('Viewing Events identify the charged custom Time Pool and retain its original name', async () => {
  const { d1, clock, authorize, heartbeat, request } = await fixture()
  d1.sqlite.exec(`
    INSERT INTO time_pools (id, child_id, name, weekday_minutes, weekend_minutes) VALUES ('science', 10, 'Science time', 20, 30);
    INSERT INTO time_pool_bindings (child_id, kind, content_id, pool_id) VALUES (10, 'video', 'approved', 'science');
  `)
  const auth = await authorize()
  await heartbeat(auth.sessionId, 1)
  clock.setTime(clock.getTime() + 15_000)
  await heartbeat(auth.sessionId, 2, 'ended')
  d1.sqlite.exec("UPDATE time_pools SET name = 'Renamed science' WHERE id = 'science'")
  const { events } = await (await request('/api/admin/children/10/viewing-events', 'GET')).json() as any
  assert.equal(events.length, 1)
  assert.equal(events[0].timePoolId, 'science')
  assert.equal(events[0].timePoolName, 'Science time')
  assert.equal(events[0].watchedSeconds, 15)
  assert.equal(d1.sqlite.prepare("SELECT used_seconds FROM time_pool_usage WHERE pool_id = 'science'").get()!.used_seconds, 15)
})

test('Viewing Events reconcile with daily totals through midnight, racing takeover, and expiration', async () => {
  const { d1, clock, authorize, heartbeat } = await fixture()
  clock.setTime(Date.parse('2026-08-17T23:59:50Z'))
  const auth = await authorize()
  await heartbeat(auth.sessionId, 1)
  clock.setTime(clock.getTime() + 14_000)
  await Promise.all([authorize(), heartbeat(auth.sessionId, 2)])
  const next = await authorize()
  await heartbeat(next.sessionId, 1)
  clock.setTime(clock.getTime() + 120_000)
  await expirePlaybackSessions({ DB: d1 as unknown as D1Database }, clock)
  await expirePlaybackSessions({ DB: d1 as unknown as D1Database }, clock)
  const sum = (table: string, column: string) => d1.sqlite.prepare(`SELECT SUM(${column}) AS seconds FROM ${table}`).get()!.seconds
  assert.equal(sum('viewing_events', 'watched_seconds'), 74)
  assert.equal(sum('viewing_events', 'watched_seconds'), sum('daily_usage_summaries', 'restricted_seconds'))
})

test('Viewing Events enforce Admin access, isolate children, paginate tied timestamps and expire detail only', async () => {
  const { d1, clock, authorize, heartbeat, request } = await fixture()
  const auth = await authorize()
  await heartbeat(auth.sessionId, 1)
  clock.setTime(clock.getTime() + 10_000)
  await heartbeat(auth.sessionId, 2, 'ended')
  const epoch = Math.floor(clock.getTime() / 1000)
  for (let i = 0; i < 52; i++) {
    d1.sqlite.prepare("INSERT INTO playback_sessions (id, child_id, viewing_day, last_sequence, last_state, last_acknowledged_at, lease_expires_at, usage_bucket, ended_at) VALUES (?, 10, '2026-08-17', 1, 'ended', ?, ?, 'restricted', ?)").run(`page-${i}`, epoch, epoch, epoch)
    d1.sqlite.prepare("INSERT INTO viewing_events (session_id, child_id, video_id, video_title, usage_bucket, authorized_at, started_at, last_watched_at, watched_seconds) VALUES (?, 10, 'approved', 'Approved', 'restricted', ?, ?, ?, 1)").run(`page-${i}`, epoch, epoch, epoch)
  }
  const path = '/api/admin/children/10/viewing-events'
  const first = await (await request(path, 'GET')).json() as any
  const second = await (await request(`${path}?cursor=${encodeURIComponent(first.nextCursor)}`, 'GET')).json() as any
  assert.equal(first.events.length, 50)
  assert.equal(second.events.length, 3)
  assert.equal(new Set([...first.events, ...second.events].map(event => event.sessionId)).size, 53)
  assert.equal(second.nextCursor, null)
  assert.equal((await request(`${path}?cursor=garbage`, 'GET')).status, 400)
  d1.sqlite.exec("INSERT INTO children (id, email) VALUES (20, 'other@example.com')")
  assert.deepEqual((await (await request('/api/admin/children/20/viewing-events', 'GET')).json() as any).events, [])
  assert.equal((await request('/api/admin/children/999/viewing-events', 'GET')).status, 404)
  const childApp = createApp({ resolveUser: async () => ({ id: 10, email: 'child@example.com', displayName: null, role: 'non-admin' }) })
  assert.equal((await childApp.request(path, {}, { DB: d1 as unknown as D1Database } as Env)).status, 403)
  clock.setTime(clock.getTime() + 30 * 86400_000 + 1000)
  assert.deepEqual((await (await request(path, 'GET')).json() as any).events, [], 'retention enforced before cron runs')
  await expirePlaybackSessions({ DB: d1 as unknown as D1Database }, clock)
  assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS n FROM viewing_events').get()!.n, 0)
  assert.equal(d1.sqlite.prepare('SELECT restricted_seconds FROM daily_usage_summaries').get()!.restricted_seconds, 10)
})
