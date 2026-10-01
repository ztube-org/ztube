import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from './app.ts'
import { syncApprovedContent } from './utils/content-sync.ts'
import { claimSyncJob, saveSyncPage } from './modules/content-sync-store.ts'
import { IsolatedD1, migrate } from './test-support/d1.ts'

async function fixture() {
  const d1 = new IsolatedD1()
  await migrate(d1)
  d1.sqlite.exec(`INSERT INTO children (id,email) VALUES (1,'child@example.com');
    INSERT INTO allowed_playlists (id,child_id,playlist_id,playlist_title) VALUES (1,1,'library','Library');
    INSERT INTO playlist_videos (playlist_id,video_id,video_title,duration) VALUES ('library','old','Old',600);`)
  const env = { DB: d1 as unknown as D1Database, YOUTUBE_API_KEY: 'test-key' } as Env
  const now = new Date('2026-09-29T12:00:00Z')
  return { d1, env, now }
}

function response(input: string | URL, lastPage: number, failPage = -1, cycle = false) {
  const url = new URL(String(input))
  if (url.pathname.endsWith('/playlists')) return Response.json({ items: [{ id: 'library', snippet: { title: 'Library' } }] })
  if (url.pathname.endsWith('/playlistItems')) {
    const page = Number(url.searchParams.get('pageToken') ?? 0)
    if (page === failPage) return Response.json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 })
    return Response.json({ items: [{ contentDetails: { videoId: `video-${page}` }, snippet: { title: 'Video' } }],
      ...(page < lastPage ? { nextPageToken: cycle && page === 2 ? '1' : String(page + 1) } : {}) })
  }
  return Response.json({ items: [{ id: url.searchParams.get('id'), snippet: { title: 'Video' }, contentDetails: { duration: 'PT10M' } }] })
}

test('a failed page preserves the old snapshot, exposes the error, and resumes without re-fetching earlier pages', async t => {
  const { d1, env, now } = await fixture()
  let fail = true
  const pages: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/playlistItems')) pages.push(url.searchParams.get('pageToken') ?? '0')
    return response(input, 2, fail ? 1 : -1)
  })
  assert.equal((await syncApprovedContent(env, { now })).failed, 1)
  assert.deepEqual(d1.sqlite.prepare('SELECT video_id FROM playlist_videos').all().map(r => r.video_id), ['old'])
  const app = createApp({ now: () => now, resolveUser: async () => ({ id: 1, email: 'child@example.com', displayName: null, role: 'admin' }) })
  let content = await (await app.request('/api/admin/children/1/content', {}, env)).json() as any
  assert.match(content.playlists[0].syncError, /quota/)
  assert.equal(content.playlists[0].lastFetchedAt, null)
  fail = false
  assert.equal((await syncApprovedContent(env, { now: new Date(now.getTime() + 1800000) })).synced, 1)
  assert.deepEqual(pages, ['0', '1', '1', '2'])
  content = await (await app.request('/api/admin/children/1/content', {}, env)).json() as any
  assert.equal(content.playlists[0].syncError, null)
  assert.equal(content.playlists[0].syncPending, false)
  assert.equal(d1.sqlite.prepare('SELECT count(*) AS n FROM content_sync_pages').get()!.n, 0)
})

test('manual sync returns accepted while a large source is still pending and subsequent clicks resume it', async t => {
  const { env, now } = await fixture()
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => response(input, 34))
  const app = createApp({ now: () => now, resolveUser: async () => ({ id: 1, email: 'child@example.com', displayName: null, role: 'admin' }) })
  const path = '/api/admin/children/1/content/playlist/1/sync'
  const first = await app.request(path, { method: 'POST' }, env)
  assert.equal(first.status, 202)
  assert.equal((await first.json() as any).syncedAt, null)
  const content = await (await app.request('/api/admin/children/1/content', {}, env)).json() as any
  assert.equal(content.playlists[0].syncPending, true)
  assert.ok(content.playlists[0].syncPages > 0)
  assert.equal((await app.request(path, { method: 'POST' }, env)).status, 200)
})

test('pagination cycles reset the staged attempt without deleting the last complete catalog', async t => {
  const { d1, env, now } = await fixture()
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => response(input, 4, -1, true))
  const result = await syncApprovedContent(env, { now })
  assert.equal(result.failed, 1)
  assert.equal(d1.sqlite.prepare('SELECT page_count FROM content_sync_jobs').get()!.page_count, 0)
  assert.equal(d1.sqlite.prepare('SELECT count(*) AS n FROM content_sync_pages').get()!.n, 0)
  assert.equal(d1.sqlite.prepare('SELECT video_id FROM playlist_videos').get()!.video_id, 'old')
})

test('expired leases fence stale Workers from publishing or clearing a newer attempt', async () => {
  const { d1, env, now } = await fixture()
  const source = { kind: 'playlist' as const, externalId: 'library' }
  const old = (await claimSyncJob(env.DB, source, now))!
  assert.equal(await claimSyncJob(env.DB, source, now), null)
  const current = (await claimSyncJob(env.DB, source, new Date(now.getTime() + 121000)))!
  const page = { videos: [], nextPageToken: null, playlistId: 'library', title: 'Library', thumbnail: '' }
  assert.equal(await saveSyncPage(env.DB, old, page, now), false)
  assert.equal(d1.sqlite.prepare('SELECT video_id FROM playlist_videos').get()!.video_id, 'old')
  assert.equal(await saveSyncPage(env.DB, current, page, now), true)
  assert.equal(d1.sqlite.prepare('SELECT count(*) AS n FROM playlist_videos').get()!.n, 0, 'a successfully fetched empty playlist removes deleted videos')
})

test('more sources than the invocation budget rotate fairly across runs, including sources that fail', async t => {
  const { d1, env, now } = await fixture()
  d1.sqlite.exec('DELETE FROM allowed_playlists')
  const insert = d1.sqlite.prepare('INSERT INTO allowed_playlists (child_id,playlist_id,playlist_title) VALUES (1,?,?)')
  for (let i = 0; i < 30; i++) insert.run(`list-${i}`, `List ${i}`)
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/playlists') && url.searchParams.get('id') === 'list-0') throw new Error('Unavailable')
    return response(input, 0)
  })
  for (let run = 0; run < 30; run++) await syncApprovedContent(env, { now: new Date(now.getTime() + run * 1800000) })
  assert.equal(d1.sqlite.prepare('SELECT count(*) AS n FROM allowed_playlists WHERE last_fetched_at IS NOT NULL').get()!.n, 29)
})

test('automatic sync skips completed channels for 24 hours while manual sync can refresh early', async t => {
  const { d1, env, now } = await fixture()
  d1.sqlite.exec("DELETE FROM allowed_playlists; INSERT INTO allowed_channels (child_id,channel_id,uploads_playlist_id,channel_title) VALUES (1,'channel','uploads','Channel')")
  const instant = now.getTime() / 1000
  d1.sqlite.prepare('UPDATE allowed_channels SET last_fetched_at = ?').run(instant)
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    calls++
    if (new URL(String(input)).pathname.endsWith('/channels')) return Response.json({ items: [{ id: 'channel', snippet: { title: 'Channel' }, contentDetails: { relatedPlaylists: { uploads: 'uploads' } } }] })
    return response(input, 0)
  })
  for (const hours of [6, 12, 23.99]) {
    const result = await syncApprovedContent(env, { now: new Date(now.getTime() + hours * 3600000) })
    assert.equal(result.synced, 0)
    assert.equal(result.skipped, 1)
  }
  assert.equal(calls, 0)
  assert.equal((await syncApprovedContent(env, { now: new Date(now.getTime() + 86400000) })).synced, 1)
  assert.equal((await syncApprovedContent(env, { target: { type: 'channel', id: 1 }, force: true, now: new Date(now.getTime() + 86400001) })).synced, 1)
})

test('each automatic heartbeat processes only one source, even when that source fails', async t => {
  const { d1, env, now } = await fixture()
  d1.sqlite.exec("INSERT INTO allowed_playlists (child_id,playlist_id,playlist_title) VALUES (1,'second','Second'); INSERT INTO allowed_videos (child_id,video_id,video_title,duration) VALUES (1,'direct','Direct',600)")
  const touched = new Set<string>()
  let fail = true
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/playlists') || (url.pathname.endsWith('/videos') && url.searchParams.get('id') === 'direct')) {
      touched.add(url.searchParams.get('id')!)
      if (fail) throw new Error('Temporary failure')
    }
    return response(input, 0)
  })
  let result = await syncApprovedContent(env, { now })
  assert.equal(result.failed, 1)
  assert.equal(result.pending, 2)
  assert.deepEqual([...touched], ['library'])
  fail = false
  touched.clear()
  result = await syncApprovedContent(env, { now: new Date(now.getTime() + 1800000) })
  assert.equal(result.synced, 1)
  assert.equal(result.pending, 2)
  assert.deepEqual([...touched], ['second'])
  touched.clear()
  result = await syncApprovedContent(env, { now: new Date(now.getTime() + 3600000) })
  assert.equal(result.synced, 1)
  assert.deepEqual([...touched], ['direct'])
})
