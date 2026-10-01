import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

test('Workers/D1: racing takeover settles once, enforces the final balance, and rolls back failed batches', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const built = await build({
    stdin: { contents: `
      import { createApp } from './server/app.ts'
      export default { fetch(request, env) {
        const app = createApp({ now: () => new Date(request.headers.get('test-time') || '2026-08-17T12:00:00Z') })
        return app.fetch(request, env)
      } }
    `, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  })
  const worker = new Miniflare(convertV4MiniflareOptions({
    workers: [{
    name: 'ztube-test',
    modules: true, script: built.outputFiles[0].text,
    compatibilityDate: '2026-08-16', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    bindings: { AUTH_MODE: 'local', LOCAL_DEV_USER_EMAIL: 'runtime@example.com', ADMIN_EMAILS: 'runtime@example.com' },
    }],
  }))
  try {
    const db = await worker.getD1Database('DB')
    const migrations = new URL('../migrations/', import.meta.url)
    // D1 exec processes one statement per line; migrations include multiline SQL.
    for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
      const source = await readFile(new URL(name, migrations), 'utf8')
      const statements = (source.replace(/--[^\n]*/g, '').match(/\s*CREATE TRIGGER\b[\s\S]*?\bEND\s*;|[^;]+;/gi) ?? []).map(sql => sql.trim())
      await db.batch(statements.map(sql => db.prepare(sql)))
    }
    const request = (path: string, body?: unknown, time = '2026-08-17T12:00:00Z', method = 'POST') => worker.dispatchFetch(`http://localhost${path}`, {
      method, headers: { 'content-type': 'application/json', 'test-time': time },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    assert.equal((await request('/api/auth/session', undefined, undefined, 'GET')).status, 200)
    await db.batch([
      db.prepare("UPDATE child_time_settings SET weekday_allowance_minutes = 15, time_zone = 'UTC'"),
      db.prepare("INSERT INTO allowed_videos (child_id, video_id, video_title, duration) VALUES (1, 'approved', 'Approved', 600)"),
    ])
    const initial = await (await request('/api/child/playback-authorizations', { videoId: 'approved' })).json() as any
    const id = initial.authorization.sessionId
    assert.equal((await request(`/api/child/playback-authorizations/${id}/heartbeats`, { sequence: 1, state: 'playing' })).status, 200)
    await db.prepare('UPDATE daily_usage_summaries SET restricted_seconds = 895').run()
    const time = '2026-08-17T12:00:10Z'
    const responses = await Promise.all([
      request('/api/child/playback-authorizations', { videoId: 'approved' }, time),
      request('/api/child/playback-authorizations', { videoId: 'approved' }, time),
      request(`/api/child/playback-authorizations/${id}/heartbeats`, { sequence: 2, state: 'playing' }, time),
    ])
    assert.equal(responses[0].status, 403)
    assert.equal(responses[1].status, 403)
    assert.equal(await db.prepare('SELECT restricted_seconds FROM daily_usage_summaries').first('restricted_seconds'), 900)
    await db.batch([
      db.prepare("INSERT INTO allowed_playlists (child_id, playlist_id, playlist_title, cartoon_pool) VALUES (1, 'pool', 'Pool', 1)"),
      db.prepare("INSERT INTO playlist_videos (playlist_id, video_id, video_title, duration) VALUES ('pool', 'ep1', 'Episode 1', 600), ('pool', 'ep2', 'Episode 2', 600)"),
    ])
    const claim = (videoId: string) => request('/api/child/episode-claims', { videoId, viewingDay: '2026-08-17', confirmed: true })
    const claims = await Promise.all([claim('ep1'), claim('ep2')])
    assert.deepEqual(claims.map(response => response.status).sort(), [200, 409])
    assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM episode_claims').first('count'), 1)
    const claimed = await db.prepare('SELECT video_id FROM episode_claims').first<string>('video_id')
    assert.equal((await claim(claimed!)).status, 200, 'D1 retries cannot double-spend a claim')
    const grant = { requestId: crypto.randomUUID(), viewingDay: '2026-08-17' }
    const grants = await Promise.all([request('/api/admin/children/1/unlock-credits', grant), request('/api/admin/children/1/unlock-credits', grant)])
    assert.ok(grants.every(response => response.status === 200))
    assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM episode_credit_grants').first('count'), 1)
    assert.equal((await claim(claimed === 'ep1' ? 'ep2' : 'ep1')).status, 200)
    assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM episode_unlocks').first('count'), 2)
    assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM playback_sessions WHERE ended_at IS NULL').first('count'), 0)
    assert.equal(await db.prepare('SELECT SUM(watched_seconds) AS seconds FROM viewing_events').first('seconds'), 5)
    await assert.rejects(() => db.batch([
      db.prepare('DELETE FROM daily_usage_summaries'),
      db.prepare('INSERT INTO missing_table VALUES (1)'),
    ]))
    assert.equal(await db.prepare('SELECT restricted_seconds FROM daily_usage_summaries').first('restricted_seconds'), 900)
  } finally { await worker.dispose() }
})

test('Workers/D1: staged sync atomically publishes shared freshness and removes staging rows', async () => {
  const { claimSyncJob, saveSyncPage, pruneSyncJobs } = await import('./modules/content-sync-store.ts')
  const worker = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'sync-test', modules: true, script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-08-16', d1Databases: ['DB'],
  }] }))
  try {
    const db = await worker.getD1Database('DB')
    const migrations = new URL('../migrations/', import.meta.url)
    for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
      const source = await readFile(new URL(name, migrations), 'utf8')
      const statements = (source.replace(/--[^\n]*/g, '').match(/\s*CREATE TRIGGER\b[\s\S]*?\bEND\s*;|[^;]+;/gi) ?? []).map(sql => sql.trim())
      await db.batch(statements.map(sql => db.prepare(sql)))
    }
    await db.batch([
      db.prepare("INSERT INTO children (id,email) VALUES (1,'one@example.com'),(2,'two@example.com')"),
      db.prepare("INSERT INTO allowed_channels (child_id,channel_id,uploads_playlist_id,channel_title) VALUES (1,'shared','uploads','Shared'),(2,'shared','uploads','Shared')"),
      db.prepare("INSERT INTO channel_videos (channel_id,video_id,video_title,duration) VALUES ('shared','old','Old',600)"),
    ])
    const now = new Date('2026-09-29T12:00:00Z')
    const source = { kind: 'channel' as const, externalId: 'shared' }
    const video = { videoId: 'new', title: 'New', description: 'Description', thumbnail: '', duration: 600, channelTitle: 'Shared', publishedAt: now, embeddable: true }
    const page = { videos: [video], nextPageToken: 'next', playlistId: 'uploads', title: 'Shared', thumbnail: '' }
    const job = (await claimSyncJob(db, source, now))!
    assert.ok(await saveSyncPage(db, job, page, now))
    assert.equal(await db.prepare('SELECT video_id FROM channel_videos').first('video_id'), 'old')
    assert.equal(await db.prepare('SELECT last_fetched_at FROM allowed_channels LIMIT 1').first('last_fetched_at'), null)
    const next = (await claimSyncJob(db, source, now))!
    assert.ok(await saveSyncPage(db, next, { ...page, videos: [{ ...video, videoId: 'newer' }], nextPageToken: null }, now))
    assert.equal(await db.prepare('SELECT count(*) AS n FROM channel_videos').first('n'), 2)
    assert.equal(await db.prepare('SELECT count(*) AS n FROM allowed_channels WHERE last_fetched_at IS NOT NULL').first('n'), 2)
    assert.equal(await db.prepare('SELECT count(*) AS n FROM content_sync_pages').first('n'), 0)
    const another = (await claimSyncJob(db, source, now))!
    await saveSyncPage(db, another, page, now)
    await db.prepare('DELETE FROM allowed_channels').run()
    await pruneSyncJobs(db)
    assert.equal(await db.prepare('SELECT count(*) AS n FROM content_sync_pages').first('n'), 0, 'orphaned staging data is removed through the foreign key')
  } finally { await worker.dispose() }
})

test('Workers: YouTube sync fetches upstream successfully and rejects redirects without forwarding the API key', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const built = await build({
    stdin: { contents: `
      import { syncApprovedContent } from './server/utils/content-sync.ts'
      export default { async fetch(request, env) {
        return Response.json(await syncApprovedContent(env, { target: { type: 'channel', id: 1 }, force: true }))
      } }
    `, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  })
  let redirect = false
  let calls = 0
  const worker = new Miniflare(convertV4MiniflareOptions({ workers: [{
    name: 'youtube-sync-test', modules: true, script: built.outputFiles[0].text,
    compatibilityDate: '2026-08-16', d1Databases: ['DB'], bindings: { YOUTUBE_API_KEY: 'test-key' },
    outboundService(request) {
      calls++
      const url = new URL(request.url)
      assert.equal(url.host, 'www.googleapis.com', 'never follow an upstream redirect')
      if (redirect) return new Response(null, { status: 302, headers: { location: 'https://unexpected.example/' } })
      if (url.pathname.endsWith('/channels')) return Response.json({ items: [{ id: 'channel', snippet: { title: 'Channel' }, contentDetails: { relatedPlaylists: { uploads: 'uploads' } } }] })
      if (url.pathname.endsWith('/playlistItems')) return Response.json({ items: [{ contentDetails: { videoId: 'video' }, snippet: { title: 'Video' } }] })
      return Response.json({ items: [{ id: 'video', snippet: {}, contentDetails: { duration: 'PT10M' } }] })
    },
  }] }))
  try {
    const db = await worker.getD1Database('DB')
    const migrations = new URL('../migrations/', import.meta.url)
    for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
      const source = await readFile(new URL(name, migrations), 'utf8')
      const statements = (source.replace(/--[^\n]*/g, '').match(/\s*CREATE TRIGGER\b[\s\S]*?\bEND\s*;|[^;]+;/gi) ?? []).map(sql => sql.trim())
      await db.batch(statements.map(sql => db.prepare(sql)))
    }
    await db.batch([
      db.prepare("INSERT INTO children (id,email) VALUES (1,'child@example.com')"),
      db.prepare("INSERT INTO allowed_channels (id,child_id,channel_id,uploads_playlist_id,channel_title) VALUES (1,1,'channel','uploads','Channel')"),
    ])
    assert.deepEqual(await (await worker.dispatchFetch('http://localhost')).json(), { synced: 1, skipped: 0, failed: 0, pending: 0 })
    assert.equal(calls, 3)
    assert.equal(await db.prepare('SELECT last_error FROM content_sync_jobs').first('last_error'), null)
    assert.equal(await db.prepare('SELECT video_id FROM channel_videos').first('video_id'), 'video')
    redirect = true
    calls = 0
    assert.equal(((await (await worker.dispatchFetch('http://localhost')).json()) as { failed: number }).failed, 1)
    assert.equal(calls, 1)
    assert.equal(await db.prepare('SELECT video_id FROM channel_videos').first('video_id'), 'video', 'failed refresh preserves the published catalog')
  } finally { await worker.dispose() }
})
