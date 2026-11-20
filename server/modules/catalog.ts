import { sql, type SQL } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import * as schema from '../database/schema.ts'
import type { ContentRule, UsageBucket } from '../../src/domain.ts'

type Database = ReturnType<typeof drizzle<typeof schema>>
export type ResolvedVideo = {
  sourceKind: 'channel' | 'playlist' | 'video'
  sourceId: string
  videoId: string
  videoTitle: string
  videoDescription: string | null
  videoThumbnail: string | null
  duration: number | null
  channelTitle: string | null
  publishedAt: Date | null
  contentRule: ContentRule
  timePoolId: string | null
  timePoolName: string | null
  timePoolConflict: boolean
  requiresClaim: boolean
  usageBucket: UsageBucket
  supported: boolean
  source: 'video' | 'playlist' | 'channel'
}

type CatalogRow = Omit<ResolvedVideo, 'publishedAt' | 'timePoolConflict' | 'requiresClaim' | 'supported'> & {
  publishedAt: number | null
  timePoolConflict: number
  requiresClaim: number
  supported: number
}

export function isShortDuration(duration: number | null) {
  return duration !== null && duration <= 180
}

export function excludeUnsupportedVideos<T extends { videoId: string; duration: number | null; embeddable?: boolean }>(videos: T[]) {
  const supported = (video: T) => !isShortDuration(video.duration) && video.embeddable !== false
  return { videos: videos.filter(supported), rejectedVideoIds: videos.filter(video => !supported(video)).map(video => video.videoId) }
}

function approvedCatalog(childId: number, videoIds?: string[]) {
  const legacyPoolPrefix = `pool:${childId}:`
  const ids = videoIds === undefined ? sql.empty() : sql`AND v.video_id IN (SELECT value FROM json_each(${JSON.stringify(videoIds)}))`
  return sql`
    WITH matches AS (
      SELECT v.video_id, v.video_title, v.video_description, v.video_thumbnail, v.duration,
        v.channel_title, v.published_at, v.content_rule, 3 AS priority, 'video' AS source_kind, v.video_id AS source_id,
        coalesce(v.channel_title, '') AS source_title, 0 AS cartoon_pool
      FROM allowed_videos v WHERE v.child_id = ${childId} AND v.is_available = 1 ${ids}
      UNION ALL
      SELECT v.video_id, v.video_title, v.video_description, v.video_thumbnail, v.duration,
        v.channel_title, v.published_at, a.content_rule, 2, 'playlist', a.playlist_id, a.playlist_title, a.cartoon_pool
      FROM allowed_playlists a JOIN playlist_videos v ON a.playlist_id = v.playlist_id
      WHERE a.child_id = ${childId} AND a.is_available = 1 ${ids}
      UNION ALL
      SELECT v.video_id, v.video_title, v.video_description, v.video_thumbnail, v.duration,
        v.channel_title, v.published_at, a.content_rule, 1, 'channel', a.channel_id, a.channel_title, 0
      FROM allowed_channels a JOIN channel_videos v ON a.channel_id = v.channel_id
      WHERE a.child_id = ${childId} AND a.is_available = 1 ${ids}
    ), ranked_matches AS (
      SELECT m.*, o.content_rule AS override_rule,
        max(m.priority) OVER (PARTITION BY m.video_id) AS top_priority,
        max(m.cartoon_pool) OVER (PARTITION BY m.video_id) AS in_cartoon_pool,
        row_number() OVER (PARTITION BY m.video_id ORDER BY m.priority DESC, m.source_id) AS metadata_rank
      FROM matches m
      LEFT JOIN video_content_rules o ON o.child_id = ${childId} AND o.video_id = m.video_id
      WHERE (m.video_id NOT LIKE 'ol:%' OR EXISTS (
        SELECT 1 FROM provider_media pm JOIN media_providers p ON p.id = pm.provider_id
        WHERE pm.video_id = m.video_id AND p.enabled = 1
          AND (p.root_path = '/' OR pm.path = p.root_path OR substr(pm.path, 1, length(p.root_path) + 1) = p.root_path || '/')
      )) AND (m.video_id NOT LIKE 'jf:%' OR EXISTS (
        SELECT 1 FROM jellyfin_media jm JOIN jellyfin_servers js ON js.id = jm.server_id
        WHERE jm.video_id = m.video_id AND js.enabled = 1
      ))
    ), binding_choices AS (
      SELECT m.*,
        CASE WHEN m.in_cartoon_pool THEN coalesce(cartoon.pool_id, ${legacyPoolPrefix} || 'cartoon')
          ELSE coalesce(video.pool_id, ${legacyPoolPrefix} || m.override_rule,
            source.pool_id, ${legacyPoolPrefix} || m.content_rule)
        END AS pool_id
      FROM ranked_matches m
      LEFT JOIN time_pool_bindings cartoon ON cartoon.child_id = ${childId} AND cartoon.kind = 'cartoon' AND cartoon.content_id = '*'
      LEFT JOIN time_pool_bindings video ON video.child_id = ${childId} AND video.kind = 'video' AND video.content_id = m.video_id
      LEFT JOIN time_pool_bindings source ON source.child_id = ${childId} AND source.kind = m.source_kind AND source.content_id = m.source_id
    ), rules AS (
      SELECT video_id,
        CASE WHEN max(CASE WHEN override_rule IS NOT NULL
          THEN override_rule = 'restricted' OR (priority = 3 AND content_rule = 'restricted')
          ELSE priority = top_priority AND content_rule = 'restricted'
        END) = 1 THEN 'restricted' ELSE 'exempt' END AS content_rule,
        min(CASE WHEN priority = top_priority THEN pool_id END) AS pool_id,
        count(DISTINCT CASE WHEN priority = top_priority THEN pool_id END) > 1 AS pool_conflict,
        max(coalesce(duration <= 180, 0)) = 0 AS supported
      FROM binding_choices GROUP BY video_id
    ), catalog AS (
      SELECT m.video_id AS videoId, m.video_title AS videoTitle, m.video_description AS videoDescription,
        m.video_thumbnail AS videoThumbnail, m.duration, m.channel_title AS channelTitle, m.published_at AS publishedAt,
        m.source_kind AS sourceKind, m.source_id AS sourceId, r.content_rule AS contentRule,
        CASE WHEN m.override_rule IS NOT NULL THEN 'video' ELSE m.source_kind END AS source,
        p.id AS timePoolId, p.name AS timePoolName, r.pool_conflict AS timePoolConflict,
        (m.in_cartoon_pool OR coalesce(p.requires_claim, 0)) AS requiresClaim,
        coalesce(p.legacy_key, r.content_rule) AS usageBucket, r.supported
      FROM ranked_matches m JOIN rules r ON r.video_id = m.video_id
      LEFT JOIN time_pools p ON p.child_id = ${childId} AND p.id = r.pool_id AND r.pool_conflict = 0
      WHERE m.metadata_rank = 1
    )
  `
}

async function catalogVideos(db: Database, catalog: SQL, selection: SQL): Promise<ResolvedVideo[]> {
  const rows = await db.all<CatalogRow>(sql`${catalog} ${selection}`)
  return rows.map(row => ({
    ...row,
    publishedAt: row.publishedAt === null ? null : new Date(row.publishedAt * 1000),
    timePoolConflict: Boolean(row.timePoolConflict),
    requiresClaim: Boolean(row.requiresClaim),
    supported: Boolean(row.supported),
  }))
}

export async function resolveApprovedVideos(db: Database, childId: number, videoIds: string[]) {
  const videos = videoIds.length ? await catalogVideos(db, approvedCatalog(childId, videoIds), sql`SELECT * FROM catalog`) : []
  return new Map(videos.map(video => [video.videoId, video]))
}

export async function claimRequiredVideos(db: Database, childId: number, options: { query: string; jellyfinOnly: boolean; unlockedOnly: boolean; page: number }) {
  const { query, jellyfinOnly, unlockedOnly, page } = options
  return catalogVideos(db, approvedCatalog(childId), sql`
    SELECT * FROM catalog c
    WHERE c.supported AND c.requiresClaim AND NOT c.timePoolConflict
      AND EXISTS (SELECT 1 FROM matches m WHERE m.video_id = c.videoId AND instr(lower(m.video_title || ' ' || m.source_title), ${query}) > 0)
      AND (${jellyfinOnly ? 1 : 0} = 0 OR c.videoId LIKE 'jf:%')
      AND (${unlockedOnly ? 1 : 0} = 0 OR EXISTS (SELECT 1 FROM episode_unlocks WHERE child_id = ${childId} AND video_id = c.videoId))
    ORDER BY c.videoTitle COLLATE NOCASE, c.videoId
    LIMIT 49 OFFSET ${page * 48}
  `)
}

export async function approvedVideoMetadata(db: Database, childId: number, videoId: string) {
  const video = (await resolveApprovedVideos(db, childId, [videoId])).get(videoId)
  return video?.supported ? video : null
}

export async function videosWithResolvedRules<T extends { videoId: string }>(db: Database, childId: number, videos: T[]) {
  const resolved = await resolveApprovedVideos(db, childId, videos.map(video => video.videoId))
  return videos.flatMap(video => {
    const match = resolved.get(video.videoId)
    return match?.supported ? [{ ...video, contentRule: match.contentRule, usageBucket: match.usageBucket, timePoolId: match.timePoolId, timePoolName: match.timePoolName, timePoolConflict: match.timePoolConflict, requiresClaim: match.requiresClaim }] : []
  })
}
