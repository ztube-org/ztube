import { sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import type * as schema from '../database/schema.ts'
import { resolveApprovedVideos } from './catalog.ts'

// Search only the authenticated Child's Approved Content, including every cached
// page of approved sources. Resolve final rules through the authorization catalog.
export async function searchApprovedVideos(db: ReturnType<typeof drizzle<typeof schema>>, childId: number, query: string, tag: string, page: number) {
  const candidates = await db.all<{ videoId: string }>(sql`
    WITH library AS (
      SELECT video_id, video_title, channel_title, duration, tags
      FROM allowed_videos WHERE child_id = ${childId} AND is_available = 1
      UNION ALL
      SELECT v.video_id, v.video_title, v.channel_title, v.duration, a.tags
      FROM allowed_channels a JOIN channel_videos v ON a.channel_id = v.channel_id
      WHERE a.child_id = ${childId} AND a.is_available = 1
      UNION ALL
      SELECT v.video_id, v.video_title, v.channel_title, v.duration, a.tags
      FROM allowed_playlists a JOIN playlist_videos v ON a.playlist_id = v.playlist_id
      WHERE a.child_id = ${childId} AND a.is_available = 1
    )
    SELECT DISTINCT video_id AS videoId FROM library
    WHERE (duration IS NULL OR duration > 180)
      AND instr(lower(video_title || ' ' || coalesce(channel_title, '') || ' ' || tags), lower(${query})) > 0
      AND (${tag} = '' OR EXISTS (SELECT 1 FROM json_each(library.tags) WHERE value = ${tag}))
    ORDER BY video_id LIMIT 51 OFFSET ${page * 50}
  `)
  const resolved = await resolveApprovedVideos(db, childId, candidates.slice(0, 50).map(row => row.videoId))
  return { videos: [...resolved.values()].filter(video => video.supported), nextPage: candidates.length > 50 ? page + 1 : null }
}
