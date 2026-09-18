import assert from 'node:assert/strict'
import { IsolatedD1, migrate } from './test-support/d1.ts'
import test from 'node:test'
import { createApp } from './app.ts'
import { syncApprovedContent } from './utils/content-sync.ts'

type Identity = { id: number; email: string; displayName: string | null; role: 'admin' | 'non-admin' }

async function fixture(identity: Identity, now = new Date('2026-08-16T12:00:00.000Z')) {
  const d1 = new IsolatedD1()
  await migrate(d1)
  d1.sqlite.exec(`
    INSERT INTO children (id, email) VALUES (10, 'child@example.com'), (20, 'other-child@example.com');
  `)
  const app = createApp({ now: () => now, resolveUser: async () => identity })
  const env = { DB: d1 as unknown as D1Database, YOUTUBE_API_KEY: 'test-key' } as Env
  return {
    d1, env,
    request(path: string, init: RequestInit = {}) { return app.request(path, init, env) },
    authorize(videoId: string, extra: Record<string, unknown> = {}) {
      return app.request('/api/child/playback-authorizations', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoId, ...extra }),
      }, env)
    },
  }
}

const child: Identity = { id: 10, email: 'child@example.com', displayName: null, role: 'non-admin' }

test('background sync stages all pages before replacing the cache and honors the freshness TTL', async () => {
  const { d1, env } = await fixture(child)
  d1.sqlite.exec("INSERT INTO allowed_playlists (id, child_id, playlist_id, playlist_title, is_available) VALUES (90, 10, 'library', 'Library', 1)")
  const originalFetch = globalThis.fetch
  let firstPage = true
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/playlists')) return Response.json({ items: [{ id: 'library', snippet: { title: 'Fresh Library', thumbnails: {} } }] })
    if (url.pathname.endsWith('/playlistItems')) {
      const videoId = url.searchParams.get('pageToken') ? 'older' : 'latest'
      firstPage = !url.searchParams.get('pageToken')
      return Response.json({ items: [{ contentDetails: { videoId }, snippet: { title: videoId, thumbnails: {}, channelTitle: 'Channel' } }], nextPageToken: firstPage ? 'next' : undefined })
    }
    const id = url.searchParams.get('id') ?? ''
    return Response.json({ items: [{ id, snippet: { title: id }, contentDetails: { duration: 'PT10M' } }] })
  }
  try {
    assert.deepEqual(await syncApprovedContent(env, { now: new Date('2026-08-17T12:00:00Z') }), { synced: 1, skipped: 0, failed: 0 })
    assert.equal((d1.sqlite.prepare('SELECT next_page_token FROM allowed_playlists WHERE id = 90').get() as any).next_page_token, null)
    assert.equal((d1.sqlite.prepare('SELECT COUNT(*) AS count FROM playlist_videos').get() as any).count, 2)
    assert.deepEqual(await syncApprovedContent(env, { now: new Date('2026-08-17T12:30:00Z') }), { synced: 0, skipped: 1, failed: 0 })
  } finally { globalThis.fetch = originalFetch }
})

test('serves cached channel videos immediately while filtering short videos by duration', async () => {
  const { d1, request } = await fixture(child)
  d1.sqlite.exec("INSERT INTO allowed_channels (id, child_id, channel_id, uploads_playlist_id, channel_title, is_available) VALUES (100, 10, 'channel', 'uploads', 'Channel', 1)")
  const originalFetch = globalThis.fetch
  let latestVersion = 1
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    const start = url.searchParams.get('pageToken') === 'older' ? 50 : 0
    if (url.pathname.endsWith('/playlistItems')) {
      return Response.json({
        items: Array.from({ length: 50 }, (_, index) => ({ contentDetails: { videoId: `video-${start + index}` }, snippet: { title: `Video ${start + index} v${latestVersion}`, thumbnails: { medium: { url: 'thumb' } }, channelTitle: 'Channel' } })),
        nextPageToken: start === 0 ? 'older' : undefined,
      })
    }
    const ids = (url.searchParams.get('id') ?? '').split(',').filter(Boolean)
    return Response.json({ items: ids.map(id => ({ id, snippet: { publishedAt: '2026-08-15T12:00:00Z' }, contentDetails: { duration: Number(id.split('-')[1]) % 2 === 1 ? 'PT2M' : 'PT4M' } })) })
  }
  try {
    const first = await (await request('/api/child/channel/100/videos?refresh=true')).json() as any
    assert.equal(first.videos.length, 25)
    assert.equal(first.videos.some((video: any) => video.videoId === 'video-1'), false)
    assert.equal(first.videos[0].publishedAt, '2026-08-15T12:00:00.000Z')
    assert.equal(first.nextPageToken, 'older')

    const cached = await (await request('/api/child/channel/100/videos')).json() as any
    assert.equal(cached.videos.length, 25)
    assert.equal(cached.videos[0].publishedAt, '2026-08-15T12:00:00.000Z')
    assert.equal(cached.cached, true)

    const older = await (await request('/api/child/channel/100/videos?page=1&pageToken=older')).json() as any
    assert.equal(older.videos[0].videoId, 'video-50')
    assert.equal(d1.sqlite.prepare('SELECT COUNT(*) AS count FROM channel_videos WHERE channel_id = ?').get('channel')?.count, 50)

    latestVersion = 2
    const refreshed = await (await request('/api/child/channel/100/videos?refresh=true')).json() as any
    assert.equal(refreshed.videos[0].videoTitle, 'Video 0 v2')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('playlist refresh removes videos deleted from the YouTube playlist', async () => {
  const { d1, request, authorize } = await fixture(child)
  d1.sqlite.exec(`
    INSERT INTO allowed_playlists (id, child_id, playlist_id, playlist_title, is_available)
      VALUES (200, 10, 'curated', 'Curated', 1);
    INSERT INTO playlist_videos (playlist_id, video_id, position, video_title, duration)
      VALUES ('curated', 'removed', 0, 'Removed video', 600),
             ('curated', 'retained', 1, 'Retained video', 600),
             ('curated', 'not-embeddable', 2, 'Blocked embed', 600);
  `)
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/playlistItems')) {
      return Response.json({ items: [
        { contentDetails: { videoId: 'retained' }, snippet: { title: 'Retained video', thumbnails: { medium: { url: 'thumb' } }, channelTitle: 'Channel' } },
        { contentDetails: { videoId: 'not-embeddable' }, snippet: { title: 'Blocked embed', thumbnails: { medium: { url: 'thumb' } }, channelTitle: 'Channel' } },
      ] })
    }
    return Response.json({ items: [
      { id: 'retained', snippet: { description: 'Synced description', publishedAt: '2026-08-15T12:00:00Z' }, contentDetails: { duration: 'PT10M' }, status: { embeddable: true } },
      { id: 'not-embeddable', snippet: { description: '', publishedAt: '2026-08-15T12:00:00Z' }, contentDetails: { duration: 'PT10M' }, status: { embeddable: false } },
    ] })
  }

  try {
    assert.equal((await authorize('removed')).status, 200)
    assert.equal((await request('/api/child/playlist/200/videos?refresh=true')).status, 200)
    assert.equal((await authorize('removed')).status, 403)
    assert.equal((await authorize('not-embeddable')).status, 403)
    const retained = await authorize('retained')
    assert.equal(retained.status, 200)
    assert.equal((await retained.json() as any).authorization.videoDescription, 'Synced description')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('shows Recommendations until opened and stores Favorites and unfinished playback progress', async () => {
  const { d1, request, authorize } = await fixture(child)
  d1.sqlite.exec("INSERT INTO allowed_videos (child_id, video_id, video_title, video_thumbnail, duration, channel_title, is_available) VALUES (10, 'favorite', 'Favorite video', 'thumb', 600, 'Channel', 1); INSERT INTO video_recommendations (child_id, video_id) VALUES (10, 'favorite')")
  const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  assert.equal((await request('/api/child/favorites', json({ videoId: 'favorite' }))).status, 200)
  const newHome = await (await request('/api/child/browse')).json() as any
  assert.equal(newHome.recommendations[0].videoId, 'favorite')
  assert.equal((await (await request('/api/child/recommendations/count')).json() as any).count, 1)

  const authorization = (await (await authorize('favorite')).json() as any).authorization
  assert.equal(authorization.favorite, true)
  assert.equal(authorization.resumeAt, 0)
  assert.equal((await (await request('/api/child/browse')).json() as any).recommendations.length, 0)

  const heartbeat = await request(`/api/child/playback-authorizations/${authorization.sessionId}/heartbeats`, json({ sequence: 1, state: 'playing', positionSeconds: 120 }))
  assert.equal(heartbeat.status, 200)
  const home = await (await request('/api/child/browse')).json() as any
  assert.equal(home.favorites[0].videoId, 'favorite')
  assert.equal(home.continueWatching[0].positionSeconds, 120)

  const resumed = (await (await authorize('favorite')).json() as any).authorization
  assert.equal(resumed.resumeAt, 120)
  await request(`/api/child/playback-authorizations/${resumed.sessionId}/heartbeats`, json({ sequence: 1, state: 'ended', positionSeconds: 600 }))
  const completedHome = await (await request('/api/child/browse')).json() as any
  assert.equal(completedHome.continueWatching.length, 0)

  await request('/api/child/favorites/favorite', { method: 'DELETE' })
  assert.equal((await (await request('/api/child/browse')).json() as any).favorites.length, 0)
})

test('authorizes direct Approved Content using a controllable clock', async () => {
  const { d1, authorize } = await fixture(child)
  d1.sqlite.exec("INSERT INTO allowed_videos (child_id, video_id, video_title, video_description, channel_title, is_available) VALUES (10, 'direct', 'Direct', 'A useful description', 'Channel', 1)")
  const response = await authorize('direct')
  assert.equal(response.status, 200)
  const body = await response.json() as any
  assert.equal(body.authorization.videoId, 'direct')
  assert.equal(body.authorization.source, 'video')
  assert.equal(body.authorization.authorizedAt, '2026-08-16T12:00:00.000Z')
  assert.equal(body.authorization.remainingSeconds, 7200)
  assert.equal(body.authorization.videoTitle, 'Direct')
  assert.equal(body.authorization.videoDescription, 'A useful description')
  assert.equal(body.authorization.channelTitle, 'Channel')
  assert.match(body.authorization.sessionId, /^[0-9a-f-]{36}$/)
})

test('authorizes videos proven through an approved channel or playlist', async () => {
  const { d1, authorize } = await fixture(child)
  d1.sqlite.exec(`
    INSERT INTO allowed_channels (child_id, channel_id, uploads_playlist_id, channel_title, is_available) VALUES (10, 'channel', 'uploads', 'Channel', 1);
    INSERT INTO channel_videos (channel_id, video_id, video_title) VALUES ('channel', 'from-channel', 'Channel video');
    INSERT INTO allowed_playlists (child_id, playlist_id, playlist_title, is_available) VALUES (10, 'playlist', 'Playlist', 1);
    INSERT INTO playlist_videos (playlist_id, video_id, video_title) VALUES ('playlist', 'from-playlist', 'Playlist video');
  `)
  assert.equal((await (await authorize('from-channel')).json() as any).authorization.source, 'channel')
  assert.equal((await (await authorize('from-playlist')).json() as any).authorization.source, 'playlist')
})

test('rejects arbitrary video IDs and does not trust unverified source hints', async () => {
  const { authorize } = await fixture(child)
  const response = await authorize('arbitrary', { playlist: 'claimed-approved-playlist', channel: 'claimed-channel' })
  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { message: 'Video is not Approved Content' })
})

test('does not authorize content approved for another Child', async () => {
  const { d1, authorize } = await fixture(child)
  d1.sqlite.exec("INSERT INTO allowed_videos (child_id, video_id, video_title, is_available) VALUES (20, 'other-video', 'Other', 1)")
  assert.equal((await authorize('other-video')).status, 403)
})

test('rejects a short video even when it exists in cached Approved Content', async () => {
  const { d1, authorize } = await fixture(child)
  d1.sqlite.exec("INSERT INTO allowed_videos (child_id, video_id, video_title, duration, is_available) VALUES (10, 'short', 'Short', 120, 1)")
  const response = await authorize('short')
  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { message: 'Videos of 3 minutes or less are not supported' })
})

test('an Admin can recommend any video available through Approved Content', async () => {
  const { d1, request } = await fixture({ id: 10, email: 'admin@example.com', displayName: null, role: 'admin' })
  d1.sqlite.exec("INSERT INTO allowed_channels (child_id, channel_id, uploads_playlist_id, channel_title, is_available) VALUES (10, 'channel', 'uploads', 'Channel', 1); INSERT INTO channel_videos (channel_id, video_id, video_title, duration) VALUES ('channel', 'recommended', 'Recommended', 600)")
  const response = await request('/api/admin/children/10/recommendations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoId: 'recommended' }) })
  assert.equal(response.status, 200)
  assert.equal(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM video_recommendations WHERE child_id = 10 AND video_id = 'recommended' AND seen_at IS NULL").get()?.count, 1)
})

test('an Admin can also use its Child profile as a viewer', async () => {
  const { d1, authorize } = await fixture({ id: 10, email: 'admin@example.com', displayName: null, role: 'admin' })
  d1.sqlite.exec("INSERT INTO allowed_videos (child_id, video_id, video_title, is_available) VALUES (10, 'admin-test', 'Admin test', 1)")
  assert.equal((await authorize('admin-test')).status, 200)
})

test('search finds older cached videos, excludes other Children and shorts, and uses literal search terms', async () => {
  const { d1, request } = await fixture(child)
  d1.sqlite.exec(`
    INSERT INTO allowed_channels (id, child_id, channel_id, uploads_playlist_id, channel_title, tags)
    VALUES (100, 10, 'channel', 'uploads', 'Science', '["Science"]'), (200, 20, 'private', 'other', 'Private', '[]');
    INSERT INTO channel_videos (channel_id, video_id, video_title, duration, position)
    VALUES ('private', 'secret', 'Deep ocean', 600, 0), ('channel', 'short', 'Deep ocean short', 120, 100);
  `)
  const insert = d1.sqlite.prepare('INSERT INTO channel_videos (channel_id, video_id, video_title, duration, position) VALUES (?, ?, ?, 600, ?)')
  for (let i = 0; i < 65; i++) insert.run('channel', `video-${i}`, i === 64 ? 'Deep ocean 100%' : `Science ${i}`, i)
  const source = await (await request('/api/child/channel/100/videos?q=ocean')).json() as any
  assert.deepEqual(source.videos.map((video: any) => video.videoId), ['video-64'])
  assert.equal(source.nextPage, null)
  const search = await (await request('/api/child/search?q=ocean')).json() as any
  assert.deepEqual(search.videos.map((video: any) => video.videoId), ['video-64'])
  const literal = await (await request('/api/child/search?q=%25')).json() as any
  assert.deepEqual(literal.videos.map((video: any) => video.videoId), ['video-64'])
  const tagged = await (await request('/api/child/search?tag=Science')).json() as any
  const next = await (await request('/api/child/search?tag=Science&page=1')).json() as any
  assert.equal(tagged.videos.length, 50)
  assert.equal(next.videos.length, 15)
  assert.equal(next.nextPage, null)
  assert.equal(new Set([...tagged.videos, ...next.videos].map((video: any) => video.videoId)).size, 65)
  assert.equal((await request('/api/child/channel/200/videos?q=ocean')).status, 404)
})
