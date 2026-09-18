import assert from 'node:assert/strict'
import { IsolatedD1, migrate } from './test-support/d1.ts'
import test from 'node:test'
import { createApp } from './app.ts'

async function fixture() {
  const d1 = new IsolatedD1()
  await migrate(d1)
  d1.sqlite.exec(`
    INSERT INTO children (id, email) VALUES (10, 'child@example.com'), (11, 'sibling@example.com'), (20, 'other-child@example.com');
    INSERT INTO child_time_settings (child_id, time_zone, weekday_allowance_minutes, weekend_allowance_minutes, safety_cap_minutes)
      VALUES (10, 'UTC', 15, 15, 15), (11, 'UTC', 15, 15, 15), (20, 'UTC', 15, 15, 15);
    INSERT INTO allowed_videos (id, child_id, video_id, video_title, is_available) VALUES
      (100, 10, 'lesson', 'Lesson', 1), (101, 10, 'game', 'Game', 1),
      (110, 11, 'lesson', 'Lesson', 1), (200, 20, 'foreign', 'Foreign', 1);
    INSERT INTO allowed_channels (id, child_id, channel_id, uploads_playlist_id, channel_title, is_available, content_rule)
      VALUES (300, 10, 'channel-a', 'uploads-a', 'Channel A', 1, 'exempt'),
             (301, 10, 'channel-b', 'uploads-b', 'Channel B', 1, 'restricted');
    INSERT INTO allowed_playlists (id, child_id, playlist_id, playlist_title, is_available, content_rule)
      VALUES (400, 10, 'playlist-a', 'Playlist A', 1, 'exempt'),
             (401, 10, 'playlist-b', 'Playlist B', 1, 'restricted');
    INSERT INTO channel_videos (channel_id, video_id, position, video_title, fetched_at) VALUES
      ('channel-a', 'overlap', 0, 'Overlap', 1786968000), ('channel-b', 'channel-conflict', 0, 'Conflict', 1786968000);
    INSERT INTO channel_videos (channel_id, video_id, position, video_title, fetched_at) VALUES
      ('channel-a', 'channel-conflict', 1, 'Conflict', 1786968000);
    INSERT INTO playlist_videos (playlist_id, video_id, position, video_title, fetched_at) VALUES
      ('playlist-a', 'overlap', 0, 'Overlap', 1786968000), ('playlist-a', 'playlist-conflict', 1, 'Conflict', 1786968000),
      ('playlist-b', 'playlist-conflict', 0, 'Conflict', 1786968000);
  `)
  const clock = new Date('2026-08-17T12:00:00.000Z')
  let user: any = { id: 1, email: 'parent@example.com', displayName: null, role: 'admin' }
  const app = createApp({ now: () => new Date(clock), resolveUser: async () => user })
  const env = { DB: d1 as unknown as D1Database } as Env
  const request = (path: string, method = 'GET', body?: unknown) => app.request(path, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }, env)
  return { d1, clock, request, asChild(id = 10) { user = { id, email: 'child@example.com', displayName: null, role: 'non-admin' } } }
}

test('Admin manages Content Rules for every Child', async () => {
  const { d1, request } = await fixture()
  const changed = await request('/api/admin/children/10/content/video/100/rule', 'PUT', { rule: 'exempt' })
  assert.equal(changed.status, 200)
  assert.equal((d1.sqlite.prepare('SELECT content_rule FROM allowed_videos WHERE id = 100').get() as any).content_rule, 'exempt')
  assert.equal((d1.sqlite.prepare('SELECT content_rule FROM allowed_videos WHERE id = 110').get() as any).content_rule, 'restricted')
  assert.equal((await request('/api/admin/children/20/content/video/200/rule', 'PUT', { rule: 'exempt' })).status, 200)
})

test('video overrides are created from trusted cached membership without duplicate standalone content', async () => {
  const { d1, request } = await fixture()
  const changed = await request('/api/admin/children/10/video-rules/overlap', 'PUT', { rule: 'restricted', sourceType: 'playlist', sourceId: 400 })
  assert.equal(changed.status, 200)
  assert.equal((d1.sqlite.prepare("SELECT count(*) AS count FROM allowed_videos WHERE video_id = 'overlap'").get() as any).count, 0)
  assert.equal((d1.sqlite.prepare("SELECT content_rule FROM video_content_rules WHERE video_id = 'overlap'").get() as any).content_rule, 'restricted')

  assert.equal((await request('/api/admin/children/10/video-rules/arbitrary', 'PUT', { rule: 'exempt', sourceType: 'playlist', sourceId: 400 })).status, 404)
  assert.equal((await request('/api/admin/children/10/video-rules/overlap', 'PUT', { rule: 'exempt', sourceType: 'playlist', sourceId: 999 })).status, 404)
})

test('Child source pages resolve each video rule independently of the source card', async () => {
  const { request, asChild } = await fixture()
  asChild()
  const channel = await (await request('/api/child/channel/300/videos')).json() as any
  assert.equal(channel.videos.find((video: any) => video.videoId === 'channel-conflict').contentRule, 'restricted')
  const playlist = await (await request('/api/child/playlist/400/videos')).json() as any
  assert.equal(playlist.videos.find((video: any) => video.videoId === 'playlist-conflict').contentRule, 'restricted')
})

test('Admin edits tags and profiles and copies only reusable Child configuration', async () => {
  const { d1, request } = await fixture()
  assert.equal((await request('/api/admin/children/10/content/channel/300/tags', 'PUT', { tags: ['Science', 'STEM'] })).status, 200)
  assert.equal((await request('/api/admin/children/11/profile', 'PUT', { displayName: 'Sibling', avatarUrl: 'https://example.com/avatar.png' })).status, 200)
  assert.equal((await request('/api/admin/children/11/content/copy', 'POST', { sourceChildId: 10 })).status, 200)
  const copied = d1.sqlite.prepare("SELECT content_rule, tags FROM allowed_channels WHERE child_id = 11 AND channel_id = 'channel-a'").get() as any
  assert.equal(copied.content_rule, 'exempt')
  assert.deepEqual(JSON.parse(copied.tags), ['Science', 'STEM'])
  assert.equal((d1.sqlite.prepare('SELECT display_name FROM children WHERE id = 11').get() as any).display_name, 'Sibling')
  assert.equal((d1.sqlite.prepare('SELECT COUNT(*) AS count FROM daily_usage_summaries WHERE child_id = 11').get() as any).count, 0)
})

test('copying new or existing Cartoon Pool approvals preserves the Episode Claim requirement', async () => {
  for (const existingApproval of [false, true]) {
    const { d1, request, asChild } = await fixture()
    d1.sqlite.exec('UPDATE allowed_playlists SET cartoon_pool = 1 WHERE id = 400')
    if (existingApproval) {
      d1.sqlite.exec("INSERT INTO allowed_playlists (child_id, playlist_id, playlist_title, cartoon_pool) VALUES (11, 'playlist-a', 'Playlist A', 0)")
    }
    assert.equal((await request('/api/admin/children/11/content/copy', 'POST', { sourceChildId: 10 })).status, 200)

    asChild(11)
    const response = await request('/api/child/playback-authorizations', 'POST', { videoId: 'overlap' })
    assert.equal(response.status, 409, `Episode Claim required with existing approval: ${existingApproval}`)
    assert.equal((await response.json() as any).code, 'episode-claim-required')
    assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS count FROM playback_sessions WHERE child_id = 11').get()?.count, 0)
  }
})

test('pool resolution is deterministic by specificity and blocks conflicting ties', async () => {
  const { d1, request, asChild } = await fixture()
  asChild()

  // Playlist specificity beats the exempt channel regardless of the route used to discover the video.
  d1.sqlite.exec("UPDATE allowed_playlists SET content_rule = 'restricted' WHERE id = 400")
  for (const routeHint of [{}, { channel: 300 }, { playlist: 400 }, { direct: true }]) {
    const response = await request('/api/child/playback-authorizations', 'POST', { videoId: 'overlap', ...routeHint })
    assert.equal(response.status, 200)
    assert.equal((await response.json() as any).authorization.usageBucket, 'restricted')
  }

  d1.sqlite.exec("UPDATE allowed_playlists SET content_rule = 'exempt' WHERE id = 401")
  // Same-level pools conflict regardless of the entry route; an explicit video binding resolves it.
  for (const videoId of ['channel-conflict', 'playlist-conflict']) {
    assert.equal((await request('/api/child/playback-authorizations', 'POST', { videoId })).status, 409)
    d1.sqlite.prepare("INSERT INTO time_pool_bindings (child_id, kind, content_id, pool_id) VALUES (10, 'video', ?, 'pool:10:restricted')").run(videoId)
    assert.equal((await request('/api/child/playback-authorizations', 'POST', { videoId })).status, 200)
  }

  d1.sqlite.exec("INSERT INTO video_content_rules (child_id, video_id, content_rule, video_title) VALUES (10, 'overlap', 'exempt', 'Overlap')")
  assert.equal((await (await request('/api/child/playback-authorizations', 'POST', { videoId: 'overlap' })).json() as any).authorization.usageBucket, 'exempt')
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
