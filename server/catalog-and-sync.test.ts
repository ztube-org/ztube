import assert from 'node:assert/strict'
import test from 'node:test'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './database/schema.ts'
import { resolveApprovedVideos } from './modules/catalog.ts'
import { syncApprovedContent } from './utils/content-sync.ts'
import { IsolatedD1, migrate } from './test-support/d1.ts'

test('bulk content resolution stays within D1 parameter limits for a large favorites collection', async () => {
  const d1 = new IsolatedD1()
  await migrate(d1)
  d1.sqlite.exec("INSERT INTO children (id, email) VALUES (1, 'child@example.com')")
  const insert = d1.sqlite.prepare("INSERT INTO allowed_videos (child_id, video_id, video_title, duration) VALUES (1, ?, ?, 600)")
  const ids = Array.from({ length: 200 }, (_, i) => `video-${i}`)
  for (const id of ids) insert.run(id, id)
  let queries = 0
  const prepare = d1.prepare.bind(d1)
  d1.prepare = sql => { queries++; return prepare(sql) }
  const videos = await resolveApprovedVideos(drizzle(d1 as unknown as D1Database, { schema }), 1, ids)
  assert.equal(videos.size, 200)
  assert.equal(queries, 5) // Two pool/binding reads plus three bounded catalog batches.
  assert.ok([...videos.values()].every(video => video.contentRule === 'restricted' && video.supported))
})

test('shared sources sync once and update freshness for every Child without changing their rules', async () => {
  const d1 = new IsolatedD1()
  await migrate(d1)
  d1.sqlite.exec(`
    INSERT INTO children (id, email) VALUES (1, 'one@example.com'), (2, 'two@example.com');
    INSERT INTO allowed_channels (child_id, channel_id, uploads_playlist_id, channel_title, content_rule)
      VALUES (1, 'shared', 'uploads', 'Channel', 'restricted'), (2, 'shared', 'uploads', 'Channel', 'exempt');
  `)
  const previousFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async input => {
    calls++
    const url = new URL(String(input))
    if (url.pathname.endsWith('/channels')) return Response.json({ items: [{ id: 'shared', snippet: { title: 'Shared' }, contentDetails: { relatedPlaylists: { uploads: 'uploads' } } }] })
    if (url.pathname.endsWith('/playlistItems')) return Response.json({ items: [{ contentDetails: { videoId: 'approved' }, snippet: { title: 'Approved' } }] })
    return Response.json({ items: [{ id: 'approved', snippet: { title: 'Approved' }, contentDetails: { duration: 'PT10M' } }] })
  }
  try {
    const env = { DB: d1 as unknown as D1Database, YOUTUBE_API_KEY: 'test-key' } as Env
    const now = new Date('2026-08-17T12:00:00Z')
    assert.deepEqual(await syncApprovedContent(env, { now }), { synced: 1, skipped: 0, failed: 0, pending: 0 })
    assert.equal(calls, 3)
    assert.deepEqual(d1.sqlite.prepare('SELECT content_rule, last_fetched_at FROM allowed_channels ORDER BY child_id').all().map(row => ({ ...row })), [
      { content_rule: 'restricted', last_fetched_at: now.getTime() / 1000 },
      { content_rule: 'exempt', last_fetched_at: now.getTime() / 1000 },
    ])
    assert.deepEqual(await syncApprovedContent(env, { now }), { synced: 0, skipped: 1, failed: 0, pending: 0 })
    assert.equal(calls, 3)
  } finally { globalThis.fetch = previousFetch }
})

test('large playlist sync resumes across bounded invocations without starving later sources or replacing a partial snapshot', async t => {
  const d1 = new IsolatedD1()
  await migrate(d1)
  d1.sqlite.exec(`
    INSERT INTO children (id, email) VALUES (1, 'child@example.com');
    INSERT INTO allowed_playlists (child_id, playlist_id, playlist_title)
      VALUES (1, 'large', 'Large'), (1, 'small', 'Small');
    INSERT INTO playlist_videos (playlist_id, video_id, video_title, duration) VALUES ('large', 'old', 'Old snapshot', 600);
    INSERT INTO allowed_videos (child_id, video_id, video_title, duration) VALUES (1, 'direct', 'Direct', 600);
  `)
  let calls = 0
  const pages: number[] = []
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    assert.ok(++calls <= 50, 'Worker subrequest limit exceeded')
    const url = new URL(String(input))
    const id = url.searchParams.get('id') ?? ''
    if (url.pathname.endsWith('/playlists')) return Response.json({ items: [{ id, snippet: { title: id }, contentDetails: { relatedPlaylists: { uploads: id } } }] })
    if (url.pathname.endsWith('/playlistItems')) {
      const large = url.searchParams.get('playlistId') === 'large'
      const page = Number(url.searchParams.get('pageToken') ?? 0)
      if (large) pages.push(page)
      return Response.json({ items: [{ contentDetails: { videoId: large ? `large-${page}` : 'small' }, snippet: { title: 'Video' } }], ...(large && page < 34 ? { nextPageToken: String(page + 1) } : {}) })
    }
    return Response.json({ items: [{ id, snippet: { title: id }, contentDetails: { duration: 'PT10M' } }] })
  })
  const env = { DB: d1 as unknown as D1Database, YOUTUBE_API_KEY: 'test-key' } as Env
  const now = new Date('2026-09-29T12:00:00Z')
  const first = await syncApprovedContent(env, { now })
  assert.equal(first.failed, 0)
  assert.ok(calls <= 20, 'automatic heartbeats use a smaller request budget')
  assert.equal(d1.sqlite.prepare("SELECT last_fetched_at FROM allowed_playlists WHERE playlist_id='small'").get()!.last_fetched_at, null, 'first heartbeat only works on the large playlist')
  assert.equal(d1.sqlite.prepare("SELECT last_fetched_at FROM allowed_videos WHERE video_id='direct'").get()!.last_fetched_at, null)
  assert.equal(d1.sqlite.prepare("SELECT last_fetched_at FROM allowed_playlists WHERE playlist_id='large'").get()!.last_fetched_at, null)
  assert.deepEqual(d1.sqlite.prepare("SELECT video_id FROM playlist_videos WHERE playlist_id='large'").all().map(row => row.video_id), ['old'])
  for (let run = 0; run < 8 && !d1.sqlite.prepare("SELECT last_fetched_at FROM allowed_playlists WHERE playlist_id='large'").get()!.last_fetched_at; run++) {
    calls = 0
    assert.equal((await syncApprovedContent(env, { now: new Date(now.getTime() + (run + 1) * 1800000) })).failed, 0)
    assert.ok(calls <= 20)
  }
  assert.ok(d1.sqlite.prepare("SELECT last_fetched_at FROM allowed_playlists WHERE playlist_id='small'").get()!.last_fetched_at, 'small playlists get a turn before the large playlist finishes')
  assert.ok(d1.sqlite.prepare("SELECT last_fetched_at FROM allowed_videos WHERE video_id='direct'").get()!.last_fetched_at, 'direct videos also get a turn')
  assert.deepEqual(pages, Array.from({ length: 35 }, (_, i) => i), 'resume from the saved page instead of restarting')
  assert.equal(d1.sqlite.prepare("SELECT count(*) AS n FROM playlist_videos WHERE playlist_id='large'").get()!.n, 35)
  assert.equal(d1.sqlite.prepare("SELECT count(*) AS n FROM playlist_videos WHERE video_id='old'").get()!.n, 0)
  assert.ok(d1.sqlite.prepare("SELECT last_fetched_at FROM allowed_playlists WHERE playlist_id='large'").get()!.last_fetched_at)
})

for (const mode of ['automatic', 'manual', 'legacy cursor', 'retry']) {
  test(`channel sync caps the upload window before filtering Shorts (${mode})`, async t => {
    const d1 = new IsolatedD1()
    await migrate(d1)
    d1.sqlite.exec(`
      INSERT INTO children (id, email) VALUES (1, 'child@example.com');
      INSERT INTO allowed_channels (id, child_id, channel_id, uploads_playlist_id, channel_title)
        VALUES (1, 1, 'large', 'uploads', 'Large');
      INSERT INTO channel_videos (channel_id, video_id, video_title, duration) VALUES ('large', 'old', 'Old snapshot', 600);
    `)
    if (mode === 'legacy cursor') d1.sqlite.exec(`
      INSERT INTO content_sync_jobs (kind, external_id, page_count, page_token, playlist_id)
        VALUES ('channel', 'large', 10, '10', 'uploads');
      INSERT INTO content_sync_pages (kind, external_id, page_number, request_token, videos)
        VALUES ('channel', 'large', 9, '9', '[]');
    `)
    const pages: number[] = []
    let calls = 0
    let failOnce = mode === 'retry'
    t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
      calls++
      const url = new URL(String(input))
      if (url.pathname.endsWith('/channels')) return Response.json({ items: [{ id: 'large', snippet: { title: 'Large' }, contentDetails: { relatedPlaylists: { uploads: 'uploads' } } }] })
      if (url.pathname.endsWith('/playlistItems')) {
        const page = Number(url.searchParams.get('pageToken') ?? 0)
        if (page === 2 && failOnce) { failOnce = false; throw new Error('Temporary upstream failure') }
        pages.push(page)
        assert.equal(url.searchParams.get('maxResults'), '50')
        assert.equal(d1.sqlite.prepare("SELECT video_id FROM channel_videos WHERE channel_id='large'").get()!.video_id, 'old', 'retain the old snapshot until all four pages are ready')
        return Response.json({ items: Array.from({ length: 50 }, (_, i) => ({ contentDetails: { videoId: `v-${page * 50 + i}` }, snippet: { title: 'Video' } })), nextPageToken: String(page + 1) })
      }
      return Response.json({ items: url.searchParams.get('id')!.split(',').map(id => ({ id, snippet: {}, contentDetails: { duration: Number(id.slice(2)) % 2 ? 'PT2M' : 'PT10M' } })) })
    })
    const env = { DB: d1 as unknown as D1Database, YOUTUBE_API_KEY: 'test-key' } as Env
    if (mode === 'retry') {
      assert.equal((await syncApprovedContent(env)).failed, 1)
      assert.equal(d1.sqlite.prepare('SELECT last_fetched_at FROM allowed_channels').get()!.last_fetched_at, null)
    }
    assert.deepEqual(await syncApprovedContent(env, mode === 'manual' ? { target: { type: 'channel', id: 1 }, force: true } : {}), { synced: 1, skipped: 0, failed: 0, pending: 0 })
    assert.deepEqual(pages, [0, 1, 2, 3])
    assert.equal(calls, mode === 'retry' ? 10 : 9)
    assert.equal(d1.sqlite.prepare("SELECT count(*) AS n FROM channel_videos WHERE channel_id='large'").get()!.n, 100)
    assert.equal(d1.sqlite.prepare("SELECT count(*) AS n FROM channel_videos WHERE video_id='old'").get()!.n, 0)
    assert.equal(d1.sqlite.prepare('SELECT count(*) AS n FROM content_sync_pages').get()!.n, 0)
    assert.equal(d1.sqlite.prepare('SELECT next_page_token FROM allowed_channels').get()!.next_page_token, null)
  })
}
