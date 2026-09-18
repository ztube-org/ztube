import { cleanupExpiredRemux } from './modules/jellyfin-remux.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from './app.ts'
import { IsolatedD1, migrate } from './test-support/d1.ts'
import { syncJellyfinLibraries } from './modules/jellyfin.ts'
import { directMp4Source, jellyfinDirectUrl, remuxSource } from './modules/jellyfin-client.ts'

const apiKey = 'private-jellyfin-api-key'
const series = '1'.repeat(32), season = '2'.repeat(32), episode = '3'.repeat(32), unsupported = '4'.repeat(32)
const mp4 = { Id: 'source-one', Container: 'mp4', Path: '/cartoons/episode.mp4', Protocol: 'File', MediaStreams: [{ Type: 'Video', Codec: 'hevc' }, { Type: 'Audio', Codec: 'aac' }] }
async function fixture(remux = false, audioConversion = false) {
  const db = new IsolatedD1(); await migrate(db)
  await db.exec("INSERT INTO children (id, email) VALUES (1, 'admin@example.com'), (2, 'child@example.com'), (3, 'other@example.com')")
  const env = { DB: db, PROVIDER_ENCRYPTION_KEY: btoa('01234567890123456789012345678901') } as unknown as Env
  let now = new Date('2026-09-17T12:00:00Z')
  const app = createApp({ now: () => now, resolveUser: async request => ({ id: Number(request.headers.get('test-child') ?? 1), email: 'test@example.com', displayName: null, role: request.headers.has('test-child') ? 'non-admin' : 'admin' }) })
  const request = (path: string, body?: unknown, method = body ? 'POST' : 'GET', child?: number, headers: Record<string, string> = {}) => app.request(`https://ztube.example.com/api/${path}`, { method, headers: { 'content-type': 'application/json', ...(child ? { 'test-child': String(child) } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }, env)
  const originalFetch = globalThis.fetch
  const calls: string[] = []
  let redirect = false, empty = false
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(url.pathname)
    assert.equal(url.origin, 'https://jellyfin.example.com')
    assert.equal(new Headers(init?.headers).get('Authorization'), url.pathname.endsWith('/stream.mp4') ? null : `MediaBrowser Client="ZTube", Device="ZTube", DeviceId="ztube", Version="1.0", Token="${apiKey}"`)
    assert.equal(init?.redirect, 'manual')
    if (redirect) return new Response(null, { status: 302, headers: { Location: 'https://different.example.com/private?api_key=' + apiKey } })
    if (url.pathname === '/jf/Library/MediaFolders') return Response.json({ Items: [{ Id: 'a'.repeat(32), Name: 'Cartoons', Type: 'CollectionFolder' }] })
    if (url.pathname === '/jf/Items') {
      if (url.searchParams.has('ids')) return Response.json({ Items: [{ Id: url.searchParams.get('ids'), Name: 'Adventure', Type: url.searchParams.get('ids') === season ? 'Season' : 'Series', SeriesName: 'Adventure', SeriesId: series }] })
      const episodes = empty ? [] : [
        { Id: episode, Name: 'First adventure', Type: 'Episode', SeriesName: 'Adventure', ParentIndexNumber: 1, IndexNumber: 1, RunTimeTicks: 600 * 10_000_000, MediaSources: [remux ? { ...mp4, Container: 'mkv', Path: '/episode.mkv', MediaStreams: [{ Type: 'Video', Codec: 'h264' }, { Type: 'Audio', Codec: 'eac3', Index: 1, Channels: 6 }] } : mp4] },
        { Id: unsupported, Name: 'MKV episode', Type: 'Episode', RunTimeTicks: 600 * 10_000_000, MediaSources: [{ ...mp4, Container: 'mkv', Path: '/episode.mkv', MediaStreams: [{ Type: 'Video', Codec: 'h264' }, { Type: 'Audio', Codec: 'dts' }] }] },
      ]
      return Response.json({ Items: episodes, TotalRecordCount: episodes.length })
    }
    if (url.pathname.endsWith('/Users')) return Response.json([{ Id: 'a'.repeat(32), Policy: { IsDisabled: false } }])
    if (url.pathname.endsWith('/ActiveEncodings')) { assert.equal(init?.method, 'DELETE'); return new Response(null, { status: 204 }) }
    if (url.pathname.endsWith('/PlaybackInfo')) {
      const body = JSON.parse(String(init?.body))
      assert.equal(body.EnableTranscoding, Boolean(body.DeviceProfile) && audioConversion)
      if (body.DeviceProfile) {
        assert.equal(body.EnableDirectStream, true)
        assert.equal(body.UserId, 'a'.repeat(32))
        assert.equal(body.AllowVideoStreamCopy, true); assert.equal(body.AllowAudioStreamCopy, !audioConversion)
        assert.equal(body.SubtitleStreamIndex, -1)
        return Response.json({ PlaySessionId: crypto.randomUUID().replaceAll('-', ''), MediaSources: [{ ...mp4, TranscodingUrl: `/jf/Videos/${episode}/master.m3u8?VideoCodec=h264&AudioCodec=aac&SubtitleMethod=Encode&api_key=old-key` }] })
      }
      assert.equal(body.EnableDirectStream, false)
      return Response.json({ MediaSources: [remux ? { ...mp4, Container: 'mkv', Path: '/episode.mkv', MediaStreams: [{ Type: 'Video', Codec: 'h264' }, { Type: 'Audio', Codec: 'eac3', Index: 1, Channels: 6 }] } : mp4] })
    }
    if (url.pathname.endsWith('/stream.mp4')) {
      assert.equal(url.searchParams.get('Static'), 'true')
      assert.equal(url.searchParams.get('MediaSourceId'), mp4.Id)
      assert.equal(new Headers(init?.headers).get('Range'), 'bytes=0-31')
      return new Response('video', { status: 206, headers: { 'Content-Range': 'bytes 0-4/100', 'Content-Type': 'video/mp4', 'Content-Length': '5', 'X-Secret': apiKey } })
    }
    if (url.pathname.endsWith('/Images/Primary')) return new Response('image', { headers: { 'Content-Type': 'image/jpeg' } })
    throw new Error('Unexpected upstream request')
  }
  const created = await request('admin/jellyfin/servers/new', { name: 'Home', url: 'https://jellyfin.example.com/jf', apiKey, enabled: true })
  assert.equal(created.status, 200)
  const { id: serverId } = await created.json() as { id: string }
  async function importSeries(id = series) {
    const result = await request(`admin/jellyfin/servers/${serverId}/import`, { itemId: id })
    assert.equal(result.status, 200, await result.clone().text())
    const body = await result.json() as { id: string; imported: number; skipped: number }
    return body
  }
  return { db, env, request, serverId, calls, importSeries, redirect: () => { redirect = true }, empty: () => { empty = true }, advance: (seconds: number) => { now = new Date(now.getTime() + seconds * 1000) }, close: () => { globalThis.fetch = originalFetch; db.sqlite.close() } }
}

test('Jellyfin configuration saves offline, encrypts and masks keys, preserves base path, and restricts administration', async () => {
  const f = await fixture()
  try {
    assert.equal(f.calls.length, 0, 'saving configuration must not require a running Jellyfin')
    assert.ok(!JSON.stringify(await f.db.prepare('SELECT * FROM jellyfin_servers').first()).includes(apiKey))
    assert.ok(!(await (await f.request('admin/jellyfin/servers')).text()).includes(apiKey))
    assert.equal((await f.request('admin/jellyfin/servers', undefined, 'GET', 2)).status, 403)
    assert.equal((await f.request(`admin/jellyfin/servers/${f.serverId}/import`, { itemId: series }, 'POST', 2)).status, 403)
    const library = await f.request(`admin/jellyfin/servers/${f.serverId}/items`)
    assert.equal(library.status, 200); assert.ok(f.calls.includes('/jf/Library/MediaFolders'))
    assert.equal((await f.request(`admin/jellyfin/servers/${f.serverId}`, { name: 'Renamed', url: 'https://jellyfin.example.com/jf/', enabled: true, revision: 1 })).status, 200)
    assert.equal((await f.request(`admin/jellyfin/servers/${f.serverId}`, { name: 'Renamed', url: 'https://jellyfin.example.com/jf/', enabled: true, revision: 1 })).status, 409)
    assert.equal((await f.request(`admin/jellyfin/servers/${f.serverId}`, { name: 'Home', url: 'https://other.example.com/', enabled: true, revision: 2 })).status, 409)
    f.redirect()
    const failed = await f.request(`admin/jellyfin/servers/${f.serverId}/items`)
    assert.equal(failed.status, 502); assert.ok(!(await failed.text()).includes(apiKey))
  } finally { f.close() }
})

test('Jellyfin imports stable episodes, requires daily claims, and gates direct URLs by Child, pool and active lease', async () => {
  const f = await fixture()
  try {
    const imported = await f.importSeries()
    assert.equal(imported.imported, 1); assert.equal(imported.skipped, 1)
    const { videoId } = (await f.db.prepare('SELECT video_id AS videoId FROM jellyfin_media').first<{ videoId: string }>())!
    assert.equal((await f.request('child/playback-authorizations', { videoId }, 'POST', 2)).status, 403)
    assert.equal((await f.request(`admin/jellyfin/imports/${imported.id}/children/2`, { approved: true }, 'PUT')).status, 200)
    const claimRequired = await f.request('child/playback-authorizations', { videoId }, 'POST', 2)
    assert.equal(claimRequired.status, 409)
    assert.equal((await claimRequired.json() as any).code, 'episode-claim-required')
    assert.equal((await f.request('child/episode-claims', { videoId, confirmed: true, viewingDay: '2026-09-17' }, 'POST', 2)).status, 200)
    const browse = await (await f.request('child/browse', undefined, 'GET', 2)).json() as any
    const seriesPage = await (await f.request(`child/playlist/${browse.playlists[0].id}/videos`, undefined, 'GET', 2)).json() as any
    assert.deepEqual(seriesPage.unlockedVideoIds, [videoId])
    const authResponse = await f.request('child/playback-authorizations', { videoId }, 'POST', 2)
    assert.equal(authResponse.status, 200, await authResponse.clone().text())
    const { authorization: auth } = await authResponse.json() as any
    assert.equal(auth.playerKind, 'native'); assert.equal(auth.timePoolId, 'pool:2:cartoon'); assert.equal(auth.remainingSeconds, 1800)
    const media = await f.request(`child/playback-authorizations/${auth.sessionId}/media`, undefined, 'GET', 2)
    assert.equal(media.status, 200)
    const url = (await media.json() as any).url as string
    assert.equal(url, `https://jellyfin.example.com/jf/Videos/${episode}/stream.mp4?Static=true&MediaSourceId=source-one`)
    assert.ok(!url.includes(apiKey), 'anonymous-capable servers do not expose credentials')
    assert.equal(media.headers.get('Cache-Control'), 'no-store')
    assert.equal((await f.request(`child/playback-authorizations/${auth.sessionId}/media`, undefined, 'GET', 3)).status, 403)
    assert.equal((await f.request(`child/playback-authorizations/${auth.sessionId}/stream`, undefined, 'GET', 2)).status, 404, 'video bytes must not be routed through the Worker')
    const sameSeason = await f.importSeries(season)
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM jellyfin_media').first<{ n: number }>())!.n, 1)
    assert.notEqual(sameSeason.id, imported.id)
    const image = await f.request(`jellyfin/${f.serverId}/images/${episode}`, undefined, 'GET', 2)
    assert.equal(image.status, 200); await image.body?.cancel()
    assert.equal((await f.request(`jellyfin/${f.serverId}/images/${unsupported}`, undefined, 'GET', 2)).status, 403)
    // A pool reduction takes effect at the media entrance as well as the UI.
    await f.db.prepare("UPDATE time_pools SET weekday_minutes = 0, weekend_minutes = 0 WHERE id = 'pool:2:cartoon'").run()
    assert.equal((await f.request(`child/playback-authorizations/${auth.sessionId}/media`, undefined, 'GET', 2)).status, 403)
    await f.db.prepare("UPDATE time_pools SET weekday_minutes = 30, weekend_minutes = 30 WHERE id = 'pool:2:cartoon'").run()
    f.advance(61)
    assert.equal((await f.request(`child/playback-authorizations/${auth.sessionId}/media`, undefined, 'GET', 2)).status, 403)
  } finally { f.close() }
})

test('Jellyfin sync preserves approvals and claims, removes unsupported episodes atomically, and honors disabled connections', async () => {
  const f = await fixture()
  try {
    const imported = await f.importSeries()
    await f.request(`admin/jellyfin/imports/${imported.id}/children/2`, { approved: true }, 'PUT')
    const videoId = (await f.db.prepare('SELECT video_id AS id FROM jellyfin_media').first<{ id: string }>())!.id
    await f.request('child/episode-claims', { videoId, confirmed: true, viewingDay: '2026-09-17' }, 'POST', 2)
    assert.equal((await f.importSeries()).id, imported.id)
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM episode_claims').first<{ n: number }>())!.n, 1)
    assert.equal((await f.request(`admin/library-playlists/${imported.id}`)).status, 409)
    f.calls.length = 0
    await syncJellyfinLibraries(f.env, new Date('2026-09-17T13:00:00Z'))
    assert.equal(f.calls.length, 0)
    f.empty()
    await syncJellyfinLibraries(f.env, new Date('2026-09-17T18:00:00Z'))
    assert.ok(f.calls.length > 0)
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM playlist_videos').first<{ n: number }>())!.n, 0)
    assert.equal((await f.request('child/playback-authorizations', { videoId }, 'POST', 2)).status, 403)
    await f.request(`admin/jellyfin/servers/${f.serverId}`, { name: 'Home', url: 'https://jellyfin.example.com/jf/', enabled: false, revision: 1 })
    assert.equal((await f.request(`admin/jellyfin/servers/${f.serverId}/items`)).status, 403)
    assert.equal((await f.request(`jellyfin/${f.serverId}/images/${series}`, undefined, 'GET', 2)).status, 403)
  } finally { f.close() }
})

test('Jellyfin direct playback supports H.264 and HEVC MP4 without remux or transcode', () => {
  assert.ok(directMp4Source([mp4]))
  assert.ok(directMp4Source([{ ...mp4, MediaStreams: [{ Type: 'Video', Codec: 'h264' }] }]))
  assert.equal(directMp4Source([{ ...mp4, Path: '/file.mkv' }]), undefined)
  assert.equal(directMp4Source([{ ...mp4, RequiresOpening: true }]), undefined)
  assert.equal(directMp4Source([{ ...mp4, Protocol: 'Http', IsRemote: true }]), undefined)
  assert.equal(directMp4Source([{ ...mp4, MediaStreams: [{ Type: 'Video', Codec: 'av1' }] }]), undefined)
})


test('direct URLs use the configured key only when Jellyfin requires authentication and never follow redirects', async () => {
  const f = await fixture()
  const savedFetch = globalThis.fetch
  try {
    const server = await f.db.prepare('SELECT * FROM jellyfin_servers WHERE id = ?').bind(f.serverId).first() as any
    for (const status of [401, 403]) {
      globalThis.fetch = async (_url, init) => {
        assert.equal(new Headers(init?.headers).get('X-Emby-Token'), null)
        assert.equal(init?.redirect, 'manual')
        return new Response(null, { status })
      }
      const direct = new URL(await jellyfinDirectUrl(f.env, server, episode, mp4.Id))
      assert.equal(direct.origin, 'https://jellyfin.example.com')
      assert.equal(direct.searchParams.get('ApiKey'), apiKey)
      assert.equal(direct.searchParams.get('Static'), 'true')
    }
    for (const status of [302, 503]) {
      globalThis.fetch = async () => new Response(null, { status, headers: { Location: 'https://other.example.com' } })
      await assert.rejects(() => jellyfinDirectUrl(f.env, server, episode, mp4.Id), /direct MP4 stream/)
    }
    globalThis.fetch = async () => new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } })
    await assert.rejects(() => jellyfinDirectUrl(f.env, server, episode, mp4.Id), /direct MP4 stream/)
  } finally { globalThis.fetch = savedFetch; f.close() }
})

test('deleting a Jellyfin import removes all sharing and sync membership while preserving other imports and remote media', async () => {
  const f = await fixture()
  try {
    const imported = await f.importSeries()
    const other = await f.importSeries(season)
    await f.request(`admin/jellyfin/imports/${imported.id}/children/2`, { approved: true }, 'PUT')
    const path = `admin/jellyfin/imports/${imported.id}`
    assert.equal((await f.request(path, { revision: 1 }, 'DELETE', 2)).status, 403)
    assert.equal((await f.request(path, { revision: 9 }, 'DELETE')).status, 409)
    assert.equal((await f.request(path, { revision: 1 }, 'DELETE')).status, 200)
    for (const table of ['jellyfin_imports', 'allowed_playlists', 'playlist_videos']) {
      assert.equal((await f.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE playlist_id = ?`).bind(imported.id).first<{ n: number }>())!.n, 0)
    }
    assert.ok(await f.db.prepare('SELECT 1 FROM jellyfin_imports WHERE playlist_id = ?').bind(other.id).first())
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM jellyfin_media').first<{ n: number }>())!.n, 1)
    await syncJellyfinLibraries(f.env, new Date('2026-09-18T12:00:00Z'))
    assert.equal(await f.db.prepare('SELECT 1 FROM curated_playlists WHERE id = ?').bind(imported.id).first(), null)
    assert.ok(f.calls.every(path => !path.includes('/Delete')))
  } finally { f.close() }
})

test('a scheduled sync already in flight cannot recreate a deleted Jellyfin import', async () => {
  const f = await fixture()
  try {
    const imported = await f.importSeries()
    const upstream = globalThis.fetch
    let deleted = false
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input))
      if (!deleted && url.pathname.endsWith('/Items') && url.searchParams.has('ids')) {
        deleted = true
        assert.equal((await f.request(`admin/jellyfin/imports/${imported.id}`, { revision: 1 }, 'DELETE')).status, 200)
      }
      return upstream(input, init)
    }
    await syncJellyfinLibraries(f.env, new Date('2026-09-18T12:00:00Z'))
    assert.equal(deleted, true)
    assert.equal(await f.db.prepare('SELECT 1 FROM curated_playlists WHERE id = ?').bind(imported.id).first(), null)
  } finally { f.close() }
})

async function authorizeRemux(f: Awaited<ReturnType<typeof fixture>>) {
  const imported = await f.importSeries()
  assert.equal(imported.imported, 1)
  const videoId = (await f.db.prepare('SELECT video_id AS id FROM jellyfin_media').first<{ id: string }>())!.id
  await f.request(`admin/jellyfin/imports/${imported.id}/children/2`, { approved: true }, 'PUT')
  await f.request('child/episode-claims', { videoId, confirmed: true, viewingDay: '2026-09-17' }, 'POST', 2)
  const { authorization } = await (await f.request('child/playback-authorizations', { videoId }, 'POST', 2)).json() as any
  return { path: `child/playback-authorizations/${authorization.sessionId}/media`, videoId }
}

test('MKV playback issues copy-only HLS directly to Jellyfin, with owned and generation-specific cleanup', async () => {
  const f = await fixture(true)
  try {
    const { path } = await authorizeRemux(f)
    const blocked = await f.request(path + '?codecs=hevc,aac', undefined, 'GET', 2)
    assert.equal(blocked.status, 415)
    assert.match(await blocked.text(), /Safari/)
    assert.ok(!f.calls.some(path => path.endsWith('/Users')), 'incompatible devices fail before Remux negotiation')
    const result = await f.request(path + '?codecs=h264,eac3', undefined, 'GET', 2)
    assert.equal(result.status, 200, await result.clone().text())
    const media = await result.json() as any
    assert.equal(media.transport, 'hls')
    const url = new URL(media.url)
    assert.equal(url.origin, 'https://jellyfin.example.com')
    assert.equal(url.pathname, `/jf/Videos/${episode}/master.m3u8`)
    for (const key of ['VideoCodec', 'AudioCodec']) assert.equal(url.searchParams.get(key), 'copy')
    assert.equal(url.searchParams.get('AudioStreamIndex'), '1')
    assert.equal(url.searchParams.get('SubtitleStreamIndex'), '-1')
    assert.equal(url.searchParams.get('SubtitleMethod'), null)
    assert.equal(url.searchParams.get('ApiKey'), apiKey)
    assert.equal(url.searchParams.get('api_key'), null)
    assert.ok(f.calls.every(path => !path.includes('.m3u8')), 'Worker must not fetch HLS manifests or segments')
    const next = await (await f.request(path + '?codecs=h264,eac3', undefined, 'GET', 2)).json() as any
    assert.notEqual(media.cleanupId, next.cleanupId)
    const stops = () => f.calls.filter(path => path.endsWith('/ActiveEncodings')).length
    await f.request(`${path}/${media.cleanupId}/stop`, {}, 'POST', 3)
    assert.equal(stops(), 0)
    f.advance(61)
    await f.request(`${path}/${media.cleanupId}/stop`, {}, 'POST', 2)
    assert.equal(stops(), 1, 'owner can clean up an expired session')
    assert.ok(await f.db.prepare('SELECT 1 FROM jellyfin_remux_sessions WHERE id = ?').bind(next.cleanupId).first())
    await f.request(`${path}/${media.cleanupId}/stop`, {}, 'POST', 2)
    assert.equal(stops(), 1, 'duplicate cleanup cannot stop another generation')
    await cleanupExpiredRemux(f.env, new Date('2026-09-17T12:02:00Z'))
    assert.equal(stops(), 2)
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM jellyfin_remux_sessions').first<{ n: number }>())!.n, 0)
  } finally { f.close() }
})

test('Remux negotiation rechecks approval and cleans up when a Child loses access in flight', async () => {
  const f = await fixture(true)
  try {
    const { path } = await authorizeRemux(f)
    const upstream = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const response = await upstream(input, init)
      if (String(input).includes('PlaybackInfo') && JSON.parse(String(init?.body)).DeviceProfile) {
        await f.db.prepare('DELETE FROM allowed_playlists WHERE child_id = 2').run()
      }
      return response
    }
    const response = await f.request(path + '?codecs=h264,eac3', undefined, 'GET', 2)
    assert.equal(response.status, 403)
    assert.ok(f.calls.some(path => path.endsWith('/ActiveEncodings')))
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM jellyfin_remux_sessions').first<{ n: number }>())!.n, 0)
  } finally { f.close() }
})

test('Remux import rejects video re-encoding but allows a compatible alternate audio track', () => {
  const mkv = { ...mp4, Container: 'mkv', Path: '/hilda.mkv' }
  assert.ok(remuxSource([mkv]))
  assert.ok(remuxSource([{ ...mkv, MediaStreams: [{ Type: 'Video', Codec: 'h264' }, { Type: 'Audio', Codec: 'dts' }, { Type: 'Audio', Codec: 'aac' }] }]))
  for (const source of [
    { ...mkv, IsRemote: true }, { ...mkv, RequiresOpening: true },
    { ...mkv, MediaStreams: [{ Type: 'Video', Codec: 'mpeg2video' }] },
    { ...mkv, MediaStreams: [{ Type: 'Video', Codec: 'h264' }, { Type: 'Audio', Codec: 'dts' }] },
  ]) assert.equal(remuxSource([source]), undefined)
})


test('automatic Remux user skips inaccessible libraries and accepts the equivalent dashed item ID', async () => {
  const f = await fixture(true)
  try {
    const { path } = await authorizeRemux(f)
    const upstream = globalThis.fetch
    const users: string[] = []
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/Users')) return Response.json([{ Id: '9'.repeat(32) }, { Id: 'a'.repeat(32) }])
      if (url.pathname.endsWith('/PlaybackInfo') && JSON.parse(String(init?.body)).DeviceProfile) {
        const body = JSON.parse(String(init?.body)); users.push(body.UserId)
        if (body.UserId === '9'.repeat(32)) return new Response(null, { status: 404 })
        const response = await upstream(input, init)
        const info = await response.json() as any
        info.MediaSources[0].TranscodingUrl = '/jf/videos/33333333-3333-3333-3333-333333333333/master.m3u8'
        return Response.json(info)
      }
      return upstream(input, init)
    }
    const response = await f.request(path + '?codecs=h264,eac3', undefined, 'GET', 2)
    assert.equal(response.status, 200, await response.clone().text())
    assert.deepEqual(users, ['9'.repeat(32), 'a'.repeat(32)])
    const { cleanupId } = await response.json() as any
    await f.request(`${path}/${cleanupId}/stop`, {}, 'POST', 2)
  } finally { f.close() }
})

test('Remux rejects foreign hosts, wrong items, and progressive addresses without issuing a URL', async () => {
  const f = await fixture(true)
  try {
    const { path } = await authorizeRemux(f)
    const upstream = globalThis.fetch
    for (const malicious of [`https://other.example.com/jf/Videos/${episode}/master.m3u8`, `/jf/Videos/${unsupported}/master.m3u8`, `/jf/Videos/${episode}/stream.mp4`]) {
      globalThis.fetch = async (input, init) => {
        const response = await upstream(input, init)
        if (String(input).includes('PlaybackInfo') && JSON.parse(String(init?.body)).DeviceProfile) {
          const info = await response.json() as any
          info.MediaSources[0].TranscodingUrl = malicious
          return Response.json(info)
        }
        return response
      }
      const response = await f.request(path + '?codecs=h264,eac3', undefined, 'GET', 2)
      assert.equal(response.status, 502)
      assert.ok(!(await response.text()).includes(apiKey))
    }
    assert.equal(f.calls.filter(path => path.endsWith('/ActiveEncodings')).length, 3)
  } finally { f.close() }
})

test('failed Remux cleanup is retained for a bounded scheduled retry', async () => {
  const f = await fixture(true)
  try {
    const { path } = await authorizeRemux(f)
    const media = await (await f.request(path + '?codecs=h264,eac3', undefined, 'GET', 2)).json() as any
    const upstream = globalThis.fetch
    globalThis.fetch = async (input, init) => String(input).includes('ActiveEncodings') ? new Response(null, { status: 503 }) : upstream(input, init)
    await f.request(`${path}/${media.cleanupId}/stop`, {}, 'POST', 2)
    assert.ok(await f.db.prepare('SELECT 1 FROM jellyfin_remux_sessions WHERE id = ?').bind(media.cleanupId).first())
    globalThis.fetch = upstream
    await cleanupExpiredRemux(f.env, new Date('2026-09-17T12:02:00Z'))
    assert.equal(await f.db.prepare('SELECT 1 FROM jellyfin_remux_sessions WHERE id = ?').bind(media.cleanupId).first(), null)
  } finally { f.close() }
})

test('Remux selects a complete native HLS path when Chrome MSE cannot play the original audio', async () => {
  const f = await fixture(true)
  try {
    const { path } = await authorizeRemux(f)
    const response = await f.request(path + '?codecs=h264,aac&nativeCodecs=h264,aac,eac3&preferNativeHls=0', undefined, 'GET', 2)
    assert.equal(response.status, 200, await response.clone().text())
    const media = await response.json() as any
    assert.equal(media.hlsEngine, 'native')
    const url = new URL(media.url)
    assert.equal(url.searchParams.get('VideoCodec'), 'copy')
    assert.equal(url.searchParams.get('AudioCodec'), 'copy')
    assert.equal(url.searchParams.get('AudioStreamIndex'), '1')
    await f.request(`${path}/${media.cleanupId}/stop`, {}, 'POST', 2)
    // Native audio support cannot be combined with MSE-only video support.
    const mixed = await f.request(path + '?codecs=h264&nativeCodecs=eac3,aac', undefined, 'GET', 2)
    assert.equal(mixed.status, 415)
  } finally { f.close() }
})

test('compatible HLS players preserve browser preference and fall back only to a complete path', async () => {
  const f = await fixture(true)
  try {
    const { path } = await authorizeRemux(f)
    for (const [query, expected] of [
      ['codecs=h264,eac3&nativeCodecs=h264,eac3&preferNativeHls=0', 'mse'],
      ['codecs=h264,eac3&nativeCodecs=h264,eac3&preferNativeHls=1', 'native'],
      ['codecs=h264,eac3&nativeCodecs=h264,aac&preferNativeHls=1', 'mse'],
    ]) {
      const response = await f.request(path + '?' + query, undefined, 'GET', 2)
      assert.equal(response.status, 200)
      const media = await response.json() as any
      assert.equal(media.hlsEngine, expected)
      await f.request(`${path}/${media.cleanupId}/stop`, {}, 'POST', 2)
    }
  } finally { f.close() }
})


test('Mac Chrome Hilda capabilities negotiate AAC audio while forcing original video copy', async () => {
  const f = await fixture(true, true)
  try {
    const { path } = await authorizeRemux(f)
    const upstream = globalThis.fetch
    let profile: any
    globalThis.fetch = async (input, init) => {
      if (String(input).includes('PlaybackInfo') && JSON.parse(String(init?.body)).DeviceProfile) profile = JSON.parse(String(init?.body))
      return upstream(input, init)
    }
    // Captured from the user's failed production request on macOS Chrome.
    const response = await f.request(path + '?codecs=h264,hevc,aac&nativeCodecs=h264,hevc,aac&preferNativeHls=0', undefined, 'GET', 2)
    assert.equal(response.status, 200, await response.clone().text())
    const media = await response.json() as any
    assert.equal(media.hlsEngine, 'mse')
    assert.equal(profile.DeviceProfile.TranscodingProfiles[0].AudioCodec, 'aac')
    assert.equal(profile.DeviceProfile.TranscodingProfiles[0].MaxAudioChannels, '2')
    const url = new URL(media.url)
    assert.equal(url.searchParams.get('VideoCodec'), 'copy')
    assert.equal(url.searchParams.get('AudioCodec'), 'aac')
    assert.equal(url.searchParams.get('AllowAudioStreamCopy'), 'false')
    assert.equal(url.searchParams.get('AudioBitrate'), '192000')
    assert.equal(url.searchParams.get('TranscodingMaxAudioChannels'), '2')
    assert.equal(url.searchParams.get('AudioStreamIndex'), '1')
    assert.equal(url.searchParams.get('SubtitleStreamIndex'), '-1')
    for (const key of ['SubtitleMethod', 'VideoBitrate', 'Width', 'Height']) assert.equal(url.searchParams.get(key), null)
    assert.ok(f.calls.every(path => !path.includes('.m3u8')), 'Worker negotiates metadata only')
    await f.request(`${path}/${media.cleanupId}/stop`, {}, 'POST', 2)
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM jellyfin_remux_sessions').first<{ n: number }>())!.n, 0)
  } finally { f.close() }
})

test('AAC fallback respects Jellyfin refusal and cleans its negotiated session', async () => {
  const f = await fixture(true, true)
  try {
    const { path } = await authorizeRemux(f)
    const upstream = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const response = await upstream(input, init)
      if (String(input).includes('PlaybackInfo') && JSON.parse(String(init?.body)).DeviceProfile) {
        const body = await response.json() as any
        delete body.MediaSources[0].TranscodingUrl
        return Response.json(body)
      }
      return response
    }
    const response = await f.request(path + '?codecs=h264,aac&nativeCodecs=h264,aac', undefined, 'GET', 2)
    assert.equal(response.status, 415)
    assert.match(await response.text(), /audio transcoding permission/)
    assert.equal(f.calls.filter(path => path.endsWith('/ActiveEncodings')).length, 1)
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM jellyfin_remux_sessions').first<{ n: number }>())!.n, 0)
  } finally { f.close() }
})

test('compatible alternate audio is copied before considering AAC conversion', async () => {
  const f = await fixture(true)
  try {
    const { path } = await authorizeRemux(f)
    const upstream = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      const response = await upstream(input, init)
      if (String(input).includes('PlaybackInfo') && !JSON.parse(String(init?.body)).DeviceProfile) {
        const body = await response.json() as any
        body.MediaSources[0].MediaStreams.push({ Type: 'Audio', Codec: 'aac', Index: 2, Channels: 2 })
        return Response.json(body)
      }
      return response
    }
    const response = await f.request(path + '?codecs=h264,aac&nativeCodecs=h264,aac', undefined, 'GET', 2)
    assert.equal(response.status, 200)
    const media = await response.json() as any
    const url = new URL(media.url)
    assert.equal(url.searchParams.get('AudioCodec'), 'copy')
    assert.equal(url.searchParams.get('AudioStreamIndex'), '2')
    assert.equal(url.searchParams.get('AudioBitrate'), null)
    await f.request(`${path}/${media.cleanupId}/stop`, {}, 'POST', 2)
  } finally { f.close() }
})
