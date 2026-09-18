import assert from 'node:assert/strict'
import test from 'node:test'
import { IsolatedD1, migrate } from './test-support/d1.ts'
import { seriesNavigation } from './modules/series-navigation.ts'

test('series navigation follows the latest permanent unlock across seasons without spending a credit', async () => {
  const db = new IsolatedD1(); await migrate(db)
  try {
    db.sqlite.exec(`INSERT INTO children(id,email) VALUES(1,'one@test'),(2,'two@test');
      INSERT INTO allowed_playlists(id,child_id,playlist_id,playlist_title) VALUES(10,1,'pl:jf:show','Show');
      INSERT INTO playlist_videos(playlist_id,video_id,video_title,position,duration) VALUES
        ('pl:jf:show','jf:one','S1 E1',0,600),('pl:jf:show','jf:two','S2 E1',1,600);
      INSERT INTO episode_unlocks(child_id,video_id,unlocked_at) VALUES(1,'jf:one',100);`)
    const hints = await seriesNavigation(db as unknown as D1Database, 1)
    assert.equal(hints[0].nextVideoId, 'jf:two')
    assert.equal(hints[0].playlistId, 10)
    assert.deepEqual(await seriesNavigation(db as unknown as D1Database, 2), [])
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM episode_claims').get()!.n, 0)
    db.sqlite.exec("DELETE FROM episode_unlocks; INSERT INTO episode_unlocks(child_id,video_id,unlocked_at) VALUES(1,'jf:two',200)")
    assert.equal((await seriesNavigation(db as unknown as D1Database, 1))[0].nextVideoId, null)
    db.sqlite.exec('DELETE FROM allowed_playlists')
    assert.deepEqual(await seriesNavigation(db as unknown as D1Database, 1), [])
  } finally { db.sqlite.close() }
})
