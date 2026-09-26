import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from './app.ts'
import { IsolatedD1, migrate } from './test-support/d1.ts'

test('Admin preview reads the selected Child library and sources without changing their state', async t => {
  const d1 = new IsolatedD1()
  await migrate(d1)
  t.after(() => d1.sqlite.close())
  d1.sqlite.exec(`
    INSERT INTO children (id, email) VALUES (10, 'first@example.com'), (20, 'second@example.com');
    INSERT INTO child_time_settings (child_id) VALUES (10), (20);
    INSERT INTO allowed_videos (child_id, video_id, video_title, duration) VALUES (10, 'first-video', 'First video', 600), (20, 'second-video', 'Second video', 600);
    INSERT INTO allowed_playlists (id, child_id, playlist_id, playlist_title) VALUES (50, 10, 'shared', 'Shared'), (60, 20, 'private', 'Private');
    INSERT INTO playlist_videos (playlist_id, video_id, video_title, duration) VALUES ('shared', 'first-episode', 'First episode', 600), ('private', 'second-episode', 'Second episode', 600);
    INSERT INTO favorite_videos (child_id, video_id) VALUES (10, 'first-video');
    INSERT INTO video_recommendations (child_id, video_id) VALUES (10, 'first-video');
  `)
  let role: 'admin' | 'non-admin' = 'admin'
  const app = createApp({ now: () => new Date('2026-08-17T12:00:00Z'), resolveUser: async () => ({ id: 20, email: 'admin@example.com', displayName: null, avatarUrl: null, role }) })
  const env = { DB: d1 as unknown as D1Database } as Env
  const get = (path: string) => app.request(path, {}, env)
  const before = (d1.sqlite.prepare('SELECT seen_at FROM video_recommendations WHERE child_id = 10').get() as { seen_at: number | null }).seen_at
  const preview = await get('/api/admin/children/10/preview')
  assert.equal(preview.status, 200)
  const body = await preview.json() as any
  assert.deepEqual(body.videos.map((v: any) => v.videoId), ['first-video'])
  assert.deepEqual(body.favorites.map((v: any) => v.videoId), ['first-video'])
  assert.deepEqual(body.recommendations.map((v: any) => v.videoId), ['first-video'])
  assert.deepEqual(body.playlists.map((p: any) => p.id), [50])
  const search = await get('/api/admin/children/10/preview/search?q=episode')
  assert.deepEqual((await search.json() as any).videos.map((v: any) => v.videoId), ['first-episode'])
  const source = await get('/api/admin/children/10/preview/playlist/50')
  assert.deepEqual((await source.json() as any).videos.map((v: any) => v.videoId), ['first-episode'])
  assert.deepEqual((await (await get('/api/admin/children/10/preview/playlist/50?refresh=true&pageToken=remote')).json() as any).videos.map((v: any) => v.videoId), ['first-episode'])
  assert.equal((await get('/api/admin/children/10/preview/playlist/60')).status, 404)
  assert.equal((await get('/api/admin/children/999/preview')).status, 404)
  assert.equal((d1.sqlite.prepare('SELECT seen_at FROM video_recommendations WHERE child_id = 10').get() as { seen_at: number | null }).seen_at, before)
  assert.equal((d1.sqlite.prepare('SELECT count(*) AS n FROM playback_sessions').get() as { n: number }).n, 0)
  assert.equal((d1.sqlite.prepare('SELECT count(*) AS n FROM daily_usage_summaries').get() as { n: number }).n, 0)
  role = 'non-admin'
  for (const path of ['/api/admin/children/10/preview', '/api/admin/children/10/preview/search', '/api/admin/children/10/preview/playlist/50']) {
    assert.equal((await get(path)).status, 403)
  }
})
