import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createApp } from './app.ts'

type Identity = { id: number | null; email: string; displayName: string | null; role: 'superadmin' | 'parent' | 'child' }

class IsolatedD1 {
  readonly sqlite = new DatabaseSync(':memory:')

  prepare(sql: string) {
    const database = this.sqlite
    let values: unknown[] = []
    const statement = () => database.prepare(sql)
    const api = {
      bind(...bindings: unknown[]) { values = bindings; return api },
      async first<T>(column?: string) {
        const row = statement().get(...values) as Record<string, unknown> | undefined
        return (column ? row?.[column] : row) as T | null ?? null
      },
      async all<T>() { return { success: true, results: statement().all(...values) as T[] } },
      async run() {
        const result = statement().run(...values)
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
      },
      async raw<T>() { return statement().all(...values).map(row => Object.values(row)) as T[] },
    }
    return api
  }

  async batch(statements: ReturnType<IsolatedD1['prepare']>[]) { return Promise.all(statements.map(statement => statement.run())) }
  async exec(sql: string) { this.sqlite.exec(sql); return { count: 1, duration: 0 } }
  withSession() { return this }
}

async function fixture(identity: Identity, now = new Date('2026-08-16T12:00:00.000Z')) {
  const d1 = new IsolatedD1()
  await d1.exec(await readFile(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'))
  await d1.exec(await readFile(new URL('../migrations/0002_child_time_settings.sql', import.meta.url), 'utf8'))
  await d1.exec(await readFile(new URL('../migrations/0003_restricted_watch_time.sql', import.meta.url), 'utf8'))
  await d1.exec(await readFile(new URL('../migrations/0004_active_playback_lease.sql', import.meta.url), 'utf8'))
  await d1.exec(await readFile(new URL('../migrations/0005_content_rules.sql', import.meta.url), 'utf8'))
  d1.sqlite.exec(`
    INSERT INTO parents (id, email) VALUES (1, 'parent@example.com'), (2, 'other@example.com');
    INSERT INTO children (id, parent_id, email) VALUES (10, 1, 'child@example.com'), (20, 2, 'other-child@example.com');
  `)
  const app = createApp({ now: () => now, resolveUser: async () => identity })
  const env = { DB: d1 as unknown as D1Database } as Env
  return {
    d1,
    authorize(videoId: string, extra: Record<string, unknown> = {}) {
      return app.request('/api/child/playback-authorizations', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoId, ...extra }),
      }, env)
    },
  }
}

const child: Identity = { id: 10, email: 'child@example.com', displayName: null, role: 'child' }

test('authorizes direct Approved Content using a controllable clock', async () => {
  const { d1, authorize } = await fixture(child)
  d1.sqlite.exec("INSERT INTO allowed_videos (child_id, video_id, video_title, is_available) VALUES (10, 'direct', 'Direct', 1)")
  const response = await authorize('direct')
  assert.equal(response.status, 200)
  const body = await response.json() as any
  assert.equal(body.authorization.videoId, 'direct')
  assert.equal(body.authorization.source, 'video')
  assert.equal(body.authorization.authorizedAt, '2026-08-16T12:00:00.000Z')
  assert.equal(body.authorization.remainingSeconds, 7200)
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

test('rejects arbitrary video IDs and does not trust an entry route', async () => {
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

test('requires a Child identity', async () => {
  const { authorize } = await fixture({ id: 1, email: 'parent@example.com', displayName: null, role: 'parent' })
  assert.equal((await authorize('anything')).status, 403)
})
