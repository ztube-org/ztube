import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from './app.ts'
import { IsolatedD1, migrate } from './test-support/d1.ts'
import { syncApprovedContent } from './utils/content-sync.ts'

const secret = 'private-password-do-not-echo'
const headerSecret = 'private-access-header'
async function fixture() {
  const d1 = new IsolatedD1(); await migrate(d1)
  await d1.exec("INSERT INTO children (id, email) VALUES (1, 'admin@example.com'), (2, 'child@example.com'), (3, 'other@example.com')")
  const env = { DB: d1, PROVIDER_ENCRYPTION_KEY: btoa('01234567890123456789012345678901'), ADMIN_EMAILS: 'admin@example.com', YOUTUBE_API_KEY: 'unused' } as unknown as Env
  let time = new Date('2026-09-14T12:00:00Z')
  const app = createApp({ now: () => time, resolveUser: async request => ({ id: Number(request.headers.get('test-child') ?? 1), email: 'test@example.com', displayName: null, role: request.headers.get('test-child') ? 'non-admin' : 'admin' }) })
  async function request(path: string, body?: unknown, method = body ? 'POST' : 'GET', child?: number) {
    return app.request(`https://ztube.example.com/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(child ? { 'test-child': String(child) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }, env)
  }
  const providerInput = { name: 'Cartoons', url: 'https://openlist.example.com/dav/', rootPath: '/Cartoons', enabled: true, username: 'parent', password: secret, headers: [{ name: 'X-ZTube-Access', value: headerSecret }] }
  const response = await request('admin/providers/new', providerInput)
  assert.equal(response.status, 200)
  const { id: providerId } = await response.json() as { id: string }
  const playlistBody = { title: 'Animation', thumbnail: '', items: [
    { providerId, path: '/Cartoons/Season 1/Episode 1.mp4', title: 'Episode 1', duration: 600, season: 'Season 1' },
    { providerId, path: '/Cartoons/Season 2/Episode 2.mp4', title: 'Episode 2', duration: 700, season: 'Season 2' },
  ] }
  const created = await request('admin/library-playlists/new', playlistBody)
  assert.equal(created.status, 200)
  const { id: playlistId } = await created.json() as { id: string }
  const row = await d1.prepare('SELECT video_id AS videoId FROM playlist_videos WHERE playlist_id = ? ORDER BY position').bind(playlistId).first<{ videoId: string }>()
  const videoId = row!.videoId
  async function share(id = playlistId, child = 2, rule = 'restricted') {
    const r = await request(`admin/library-playlists/${id}/children/${child}`, { approved: true, contentRule: rule, tags: ['cartoon'] }, 'PUT')
    assert.equal(r.status, 200)
  }
  return { d1, env, request, providerInput, providerId, playlistBody, playlistId, videoId, share, time: (seconds: number) => { time = new Date(`2026-09-14T12:00:00Z`); time.setSeconds(seconds) } }
}

test('Providers: encrypted credentials, Admin-only routes, masked reads, bounded paths and secret replacement', async () => {
  const f = await fixture()
  try {
    const stored = await f.d1.prepare('SELECT * FROM media_providers').first()
    assert.ok(!JSON.stringify(stored).includes(secret)); assert.ok(!JSON.stringify(stored).includes(headerSecret))
    const read = await (await f.request('admin/providers')).text()
    assert.ok(read.includes('X-ZTube-Access')); assert.ok(!read.includes(secret)); assert.ok(!read.includes(headerSecret))
    assert.equal((await f.request('admin/providers', undefined, 'GET', 2)).status, 403)
    assert.equal((await f.request('admin/providers/new', f.providerInput, 'POST', 2)).status, 403)
    assert.equal((await f.request(`admin/library-playlists/${f.playlistId}`, undefined, 'GET', 2)).status, 403)
    assert.equal((await f.request(`admin/providers/${f.providerId}/browse`, { path: '/Cartoons/../private', page: 1 })).status, 400)
    assert.equal((await f.request(`admin/providers/${f.providerId}/browse`, { path: '/private', page: 1 })).status, 403)
    const invalid = await f.request('admin/providers/new', { ...f.providerInput, name: '', password: secret })
    assert.equal(invalid.status, 400); assert.ok(!(await invalid.text()).includes(secret))
    assert.equal((await f.request('admin/providers/new', { ...f.providerInput, headers: [{ name: 'Authorization', value: headerSecret }] })).status, 400)
    assert.equal((await f.request(`admin/providers/${f.providerId}`, { ...f.providerInput, revision: 1, password: undefined, headers: [{ name: 'X-ZTube-Access' }] })).status, 200)
    assert.equal((await f.request(`admin/providers/${f.providerId}`, { ...f.providerInput, revision: 1 })).status, 409)
    assert.equal((await f.request(`admin/providers/${f.providerId}`, { ...f.providerInput, revision: 2, url: 'https://different.example.com', password: undefined })).status, 409)
  } finally { f.d1.sqlite.close() }
})

test('Playlists: explicit sharing, stable media IDs, atomic revisions, independent rules and sync isolation', async () => {
  const f = await fixture()
  const originalFetch = globalThis.fetch
  try {
    assert.equal((await f.request('child/playback-authorizations', { videoId: f.videoId }, 'POST', 2)).status, 403)
    await f.share()
    const second = await (await f.request('admin/library-playlists/new', { ...f.playlistBody, title: 'Second' })).json() as { id: string }
    await f.share(second.id, 2, 'exempt')
    await f.share(f.playlistId, 3, 'exempt')
    assert.equal((await f.request('child/playback-authorizations', { videoId: f.videoId }, 'POST', 2)).status, 409)
    await f.request('admin/children/2/time-pool-bindings', { kind: 'video', contentId: f.videoId, poolId: 'pool:2:restricted' }, 'PUT')
    let auth = await (await f.request('child/playback-authorizations', { videoId: f.videoId }, 'POST', 2)).json() as any
    assert.equal(auth.authorization.usageBucket, 'restricted'); assert.equal(auth.authorization.playerKind, 'native')
    auth = await (await f.request('child/playback-authorizations', { videoId: f.videoId }, 'POST', 3)).json() as any
    assert.equal(auth.authorization.usageBucket, 'exempt')
    const browse = await (await f.request('child/browse', undefined, 'GET', 2)).json() as any
    assert.equal(browse.playlists.length, 2); assert.equal(browse.videos.length, 0)
    const episodes = await (await f.request(`child/playlist/${browse.playlists[0].id}/videos?refresh=true`, undefined, 'GET', 2)).json() as any
    assert.equal(episodes.playlist.curated, true); assert.equal(episodes.videos[1].season, 'Season 2')
    assert.ok(!JSON.stringify(episodes).includes('/Cartoons'))
    const updates = await Promise.all(['First edit', 'Second edit'].map(title => f.request(`admin/library-playlists/${f.playlistId}`, { ...f.playlistBody, title, revision: 1 })))
    assert.deepEqual(updates.map(r => r.status).sort(), [200, 409])
    const saved = await (await f.request(`admin/library-playlists/${f.playlistId}`)).json() as any
    assert.equal(saved.playlist.revision, 2); assert.equal(saved.items.length, 2)
    assert.equal((await f.request('admin/library-playlists/new', { ...f.playlistBody, items: [{ ...f.playlistBody.items[0], duration: 180 }] })).status, 400)
    await f.request(`admin/library-playlists/${f.playlistId}/children/2`, { approved: false, contentRule: 'restricted', tags: [] }, 'PUT')
    await f.request('admin/children/2/time-pool-bindings', { kind: 'video', contentId: f.videoId, poolId: null }, 'PUT')
    auth = await (await f.request('child/playback-authorizations', { videoId: f.videoId }, 'POST', 2)).json() as any
    assert.equal(auth.authorization.usageBucket, 'exempt')
    globalThis.fetch = async () => { throw new Error('Curated Playlists must never reach YouTube sync') }
    assert.deepEqual(await syncApprovedContent(f.env, { force: true }), { synced: 0, skipped: 0, failed: 0 })
  } finally { globalThis.fetch = originalFetch; f.d1.sqlite.close() }
})

test('WebDAV playback: session-bound media resolution, credential containment, lease, time, revocation and YouTube isolation', async () => {
  const f = await fixture(); const originalFetch = globalThis.fetch
  const requests: string[] = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push(url.pathname)
    assert.equal(init?.redirect, 'manual')
    const headers = new Headers(init?.headers)
    if (url.origin === 'https://openlist.example.com') {
      assert.equal(init?.method, 'GET')
      assert.equal(headers.get('X-ZTube-Access'), headerSecret)
      assert.equal(headers.get('Authorization'), `Basic ${btoa('parent:' + secret)}`)
      assert.ok(url.pathname.startsWith('/dav/Cartoons/'))
      return new Response(null, { status: 302, headers: { location: 'https://media.example.com/episode.mp4?signature=temporary' } })
    }
    assert.equal(url.origin, 'https://media.example.com')
    assert.equal(headers.get('X-ZTube-Access'), null)
    assert.equal(headers.get('Authorization'), null)
    assert.equal(headers.get('Range'), 'bytes=0-0')
    return new Response('x', { status: 206, headers: { 'content-type': 'video/mp4' } })
  }
  try {
    await f.share()
    const authorize = async () => (await (await f.request('child/playback-authorizations', { videoId: f.videoId }, 'POST', 2)).json() as any).authorization
    const auth = await authorize(); const mediaPath = `child/playback-authorizations/${auth.sessionId}/media`
    assert.equal((await f.request(mediaPath, undefined, 'GET', 3)).status, 403)
    const media = await f.request(mediaPath, undefined, 'GET', 2)
    assert.equal(media.status, 200); assert.equal(media.headers.get('cache-control'), 'no-store')
    const response = await media.text(); assert.ok(response.includes('media.example.com')); assert.ok(!response.includes(headerSecret)); assert.ok(!response.includes('untrusted-directory-display'))
    assert.equal(requests.filter(p => p.startsWith('/api/')).length, 0)
    await f.request(`child/playback-authorizations/${auth.sessionId}/heartbeats`, { sequence: 1, state: 'playing' }, 'POST', 2)
    f.time(15)
    await f.request(`child/playback-authorizations/${auth.sessionId}/heartbeats`, { sequence: 2, state: 'paused', positionSeconds: 40 }, 'POST', 2)
    assert.equal(await f.d1.prepare('SELECT restricted_seconds FROM daily_usage_summaries WHERE child_id = 2').first('restricted_seconds'), 15)
    const takeover = await authorize()
    assert.equal((await f.request(mediaPath, undefined, 'GET', 2)).status, 403)
    const activePath = `child/playback-authorizations/${takeover.sessionId}/media`
    await f.request(`child/playback-authorizations/${takeover.sessionId}/heartbeats`, { sequence: 1, state: 'playing' }, 'POST', 2)
    await f.d1.prepare('UPDATE daily_usage_summaries SET restricted_seconds = 3599 WHERE child_id = 2').run()
    f.time(17)
    assert.equal((await f.request(activePath, undefined, 'GET', 2)).status, 403, 'pending active seconds exhaust allowance before the next heartbeat')
    await f.d1.prepare('UPDATE daily_usage_summaries SET restricted_seconds = 0 WHERE child_id = 2').run()
    await f.request(`admin/providers/${f.providerId}`, { ...f.providerInput, enabled: false, revision: 1 })
    assert.equal((await f.request(activePath, undefined, 'GET', 2)).status, 403)
    const denied = await (await f.request(`child/playback-authorizations/${takeover.sessionId}/heartbeats`, { sequence: 2, state: 'playing' }, 'POST', 2)).json() as any
    assert.equal(denied.authorized, false)
    await f.d1.exec("INSERT INTO allowed_videos (child_id, video_id, video_title, duration) VALUES (2, 'youtube-original', 'YouTube', 600)")
    const yt = await (await f.request('child/playback-authorizations', { videoId: 'youtube-original' }, 'POST', 2)).json() as any
    assert.equal(yt.authorization.playerKind, 'youtube')
  } finally { globalThis.fetch = originalFetch; f.d1.sqlite.close() }
})

test('WebDAV transport: Access redirects are diagnosed and approval is checked after resolution', async () => {
  const f = await fixture(); const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login/' } })
    const blocked = await f.request(`admin/providers/${f.providerId}/browse`, { path: '/Cartoons', page: 1 })
    assert.equal(blocked.status, 502); assert.ok((await blocked.text()).includes('Cloudflare Access'))
    globalThis.fetch = async (input) => {
      if (String(input).startsWith('https://openlist.example.com/')) return new Response(null, { status: 302, headers: { location: 'https://media.example.com/movie.mp4' } })
      await f.request(`admin/library-playlists/${f.playlistId}/children/2`, { approved: false, contentRule: 'restricted', tags: [] }, 'PUT')
      return new Response('x', { headers: { 'content-type': 'video/mp4' } })
    }
    await f.share()
    const auth = await (await f.request('child/playback-authorizations', { videoId: f.videoId }, 'POST', 2)).json() as any
    assert.equal((await f.request(`child/playback-authorizations/${auth.authorization.sessionId}/media`, undefined, 'GET', 2)).status, 403)
  } finally { globalThis.fetch = originalFetch; f.d1.sqlite.close() }
})

test('legacy OpenList Providers retain endpoint mapping, credentials and media IDs when migrated to WebDAV', async () => {
  const f = await fixture()
  try {
    await f.d1.prepare('UPDATE media_providers SET webdav_url = NULL, session_token = ? WHERE id = ?').bind('unused-legacy-token', f.providerId).run()
    const read = await (await f.request('admin/providers')).json() as any
    assert.equal(read.providers[0].url, 'https://openlist.example.com/dav/')
    assert.equal(read.providers[0].id, f.providerId)
    assert.equal(read.providers[0].hasPassword, true)
    assert.equal((await f.request(`admin/providers/${f.providerId}`, { ...f.providerInput, revision: 1, password: undefined })).status, 200)
    assert.equal(await f.d1.prepare('SELECT video_id FROM playlist_videos ORDER BY position LIMIT 1').first('video_id'), f.videoId)
  } finally { f.d1.sqlite.close() }
})

test('deleting a WebDAV Playlist revokes sharing atomically, rejects stale editors, and preserves other lists and media', async () => {
  const f = await fixture()
  try {
    await f.share()
    await f.share(f.playlistId, 3)
    const other = await (await f.request('admin/library-playlists/new', f.playlistBody)).json() as { id: string }
    await f.share(other.id)
    const path = `admin/library-playlists/${f.playlistId}`
    assert.equal((await f.request(path, { revision: 1 }, 'DELETE', 2)).status, 403)
    assert.equal((await f.request(path, { revision: 2 }, 'DELETE')).status, 409)
    assert.equal((await f.request(path)).status, 200)
    assert.equal((await f.request(path, { revision: 1 }, 'DELETE')).status, 200)
    assert.equal((await f.request(path)).status, 404)
    assert.equal((await f.d1.prepare('SELECT COUNT(*) AS n FROM allowed_playlists WHERE playlist_id = ?').bind(f.playlistId).first<{ n: number }>())!.n, 0)
    assert.equal((await f.d1.prepare('SELECT COUNT(*) AS n FROM playlist_videos WHERE playlist_id = ?').bind(f.playlistId).first<{ n: number }>())!.n, 0)
    assert.equal((await f.request(`admin/library-playlists/${other.id}`)).status, 200)
    assert.equal((await f.d1.prepare('SELECT COUNT(*) AS n FROM provider_media').first<{ n: number }>())!.n, 2)
    assert.equal((await f.request('admin/library-playlists/pl:jf:protected', { revision: 1 }, 'DELETE')).status, 400)
  } finally { f.d1.sqlite.close() }
})
