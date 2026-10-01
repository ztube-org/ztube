import assert from 'node:assert/strict'
import test from 'node:test'
import { IsolatedD1, migrate } from './test-support/d1.ts'
import type { VideoMetadata } from './utils/youtube-api.ts'
import { claimSyncJob, saveSyncPage } from './modules/content-sync-store.ts'

for (const kind of ['channel', 'playlist'] as const) {
  test(`${kind} sync only writes changed catalog rows and publishes atomically`, async () => {
    const d1 = new IsolatedD1()
    await migrate(d1)
    const db = d1 as unknown as D1Database
    const table = `${kind}_videos`
    d1.sqlite.exec(`INSERT INTO children (id,email) VALUES (1,'child@example.com');
      INSERT INTO allowed_${kind}s (child_id,${kind}_id,${kind}_title${kind === 'channel' ? ',uploads_playlist_id' : ''})
      VALUES (1,'source','Source'${kind === 'channel' ? ",'uploads'" : ''});
      CREATE TABLE catalog_writes (operation TEXT, video_id TEXT);
      CREATE TRIGGER audit_insert AFTER INSERT ON ${table} BEGIN INSERT INTO catalog_writes VALUES ('insert',new.video_id); END;
      CREATE TRIGGER audit_update AFTER UPDATE ON ${table} BEGIN INSERT INTO catalog_writes VALUES ('update',new.video_id); END;
      CREATE TRIGGER audit_delete AFTER DELETE ON ${table} BEGIN INSERT INTO catalog_writes VALUES ('delete',old.video_id); END;`)
    const source = { kind, externalId: 'source' }
    const now = new Date('2026-10-01T00:00:00Z')
    const videos: VideoMetadata[] = ['unchanged', 'changed', 'removed'].map(videoId => ({ videoId, title: videoId, description: '', thumbnail: '', duration: 600, channelTitle: 'Source', publishedAt: null, embeddable: true }))
    const page = { videos, nextPageToken: null, playlistId: 'uploads', title: 'Source', thumbnail: '' }
    const publish = async (data: typeof page, instant: Date) => saveSyncPage(db, (await claimSyncJob(db, source, instant))!, data, instant)
    await publish(page, now)
    d1.sqlite.exec('DELETE FROM catalog_writes')
    const later = new Date(now.getTime() + 86400000)
    await publish(page, later)
    assert.equal(d1.sqlite.prepare('SELECT count(*) AS n FROM catalog_writes').get()!.n, 0, 'identical snapshots must not insert, delete or update any catalog row')
    assert.equal(d1.sqlite.prepare(`SELECT last_fetched_at FROM allowed_${kind}s`).get()!.last_fetched_at, later.getTime() / 1000)
    assert.equal(d1.sqlite.prepare(`SELECT fetched_at FROM ${table} LIMIT 1`).get()!.fetched_at, now.getTime() / 1000, 'row timestamps change only with content')
    await publish({ ...page, videos: [videos[0], { ...videos[1], description: 'Updated', publishedAt: now }, { ...videos[2], videoId: 'added' }] }, later)
    assert.deepEqual(d1.sqlite.prepare('SELECT operation,video_id FROM catalog_writes ORDER BY operation,video_id').all().map(r => ({ ...r })), [
      { operation: 'delete', video_id: 'removed' }, { operation: 'insert', video_id: 'added' }, { operation: 'update', video_id: 'changed' },
    ])
    d1.sqlite.exec('DELETE FROM catalog_writes')
    await publish({ ...page, videos: [videos[1], videos[0], { ...videos[2], videoId: 'added' }] }, later)
    assert.deepEqual(d1.sqlite.prepare('SELECT operation,video_id FROM catalog_writes ORDER BY video_id').all().map(r => ({ ...r })), [
      { operation: 'update', video_id: 'changed' }, { operation: 'update', video_id: 'unchanged' },
    ], 'ordering and null metadata transitions must be applied')
    d1.sqlite.exec(`CREATE TRIGGER fail_publish BEFORE UPDATE ON allowed_${kind}s BEGIN SELECT RAISE(ABORT,'publish failed'); END;`)
    await assert.rejects(() => publish({ ...page, videos: [] }, later), /publish failed/)
    assert.equal(d1.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 3, 'a failed publish rolls back deletions')
  })
}
