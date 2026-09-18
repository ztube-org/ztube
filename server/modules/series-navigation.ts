// The latest permanent unlock is the stable pointer for the next episode. It
// survives progress cleanup and viewing-event retention, and grants no access.
export async function seriesNavigation(db: D1Database, childId: number) {
  const rows = await db.prepare(`WITH choices AS (
    SELECT a.id AS playlistId, a.playlist_title AS seriesTitle, p.playlist_id AS externalId,
      p.video_id AS previousVideoId, p.video_title AS previousTitle, p.position,
      row_number() OVER (PARTITION BY a.id ORDER BY u.unlocked_at DESC, p.position DESC) AS rank
    FROM allowed_playlists a JOIN playlist_videos p ON p.playlist_id = a.playlist_id
    JOIN episode_unlocks u ON u.video_id = p.video_id AND u.child_id = a.child_id
    WHERE a.child_id = ? AND a.is_available = 1 AND a.playlist_id LIKE 'pl:jf:%'
  ) SELECT x.playlistId, x.seriesTitle, x.previousVideoId, x.previousTitle,
    n.video_id AS nextVideoId, n.video_title AS nextTitle
  FROM choices x LEFT JOIN playlist_videos n ON n.id = (
    SELECT id FROM playlist_videos WHERE playlist_id = x.externalId AND position > x.position
      AND duration > 180 ORDER BY position, id LIMIT 1
  ) WHERE x.rank = 1`).bind(childId).all()
  return rows.results
}
