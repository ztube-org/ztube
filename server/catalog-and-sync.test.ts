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
    assert.deepEqual(await syncApprovedContent(env, { now }), { synced: 1, skipped: 0, failed: 0 })
    assert.equal(calls, 3)
    assert.deepEqual(d1.sqlite.prepare('SELECT content_rule, last_fetched_at FROM allowed_channels ORDER BY child_id').all().map(row => ({ ...row })), [
      { content_rule: 'restricted', last_fetched_at: now.getTime() / 1000 },
      { content_rule: 'exempt', last_fetched_at: now.getTime() / 1000 },
    ])
    assert.deepEqual(await syncApprovedContent(env, { now }), { synced: 0, skipped: 1, failed: 0 })
    assert.equal(calls, 3)
  } finally { globalThis.fetch = previousFetch }
})
