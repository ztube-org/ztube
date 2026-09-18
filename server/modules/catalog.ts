import { playbackReads } from '../database/playback-reads.ts'
import { sql } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/d1'
import * as schema from '../database/schema.ts'
import type { ContentRule, UsageBucket } from '../../src/domain.ts'

type Database = ReturnType<typeof drizzle<typeof schema>>
type Match = {
  sourceKind: 'channel' | 'playlist' | 'video'
  sourceId: string
  cartoonPool: number
  videoId: string
  videoTitle: string
  videoDescription: string | null
  videoThumbnail: string | null
  duration: number | null
  channelTitle: string | null
  publishedAt: number | null
  contentRule: ContentRule
  overrideRule: ContentRule | null
  priority: number
}

export function isShortDuration(duration: number | null) {
  return duration !== null && duration <= 180
}

export function excludeUnsupportedVideos<T extends { videoId: string; duration: number | null; embeddable?: boolean }>(videos: T[]) {
  const supported = (video: T) => !isShortDuration(video.duration) && video.embeddable !== false
  return { videos: videos.filter(supported), rejectedVideoIds: videos.filter(video => !supported(video)).map(video => video.videoId) }
}

// Approval, metadata and Content Rules cross the same query/interface everywhere.
// Overrides affect policy only; they never create membership in Approved Content.
export async function resolveApprovedVideos(db: Database, childId: number, videoIds: string[]) {
  const result = new Map<string, ResolvedVideo>()
  const ids = [...new Set(videoIds)]
  const [pools, bindings] = await Promise.all([
    playbackReads(db).pools().execute({ childId }),
    playbackReads(db).bindings().execute({ childId }),
  ])
  const boundPool = (kind: string, id: string) => bindings.find(b => b.kind === kind && b.contentId === id)?.poolId
  const legacyPool = (rule: UsageBucket) => `pool:${childId}:${rule}`
  for (let offset = 0; offset < ids.length; offset += 90) {
    const requested = sql.join(ids.slice(offset, offset + 90).map(id => sql`(${id})`), sql`, `)
    const rows = await db.all<Match>(sql`
      WITH requested(video_id) AS (VALUES ${requested}), matches AS (
        SELECT v.video_id, v.video_title, v.video_description, v.video_thumbnail, v.duration,
          v.channel_title, v.published_at, v.content_rule, 3 AS priority, 'video' AS source_kind, v.video_id AS source_id
        FROM allowed_videos v JOIN requested r ON r.video_id = v.video_id
        WHERE v.child_id = ${childId} AND v.is_available = 1
        UNION ALL
        SELECT v.video_id, v.video_title, v.video_description, v.video_thumbnail, v.duration,
          v.channel_title, v.published_at, a.content_rule, 2, 'playlist', a.playlist_id
        FROM allowed_playlists a JOIN playlist_videos v ON a.playlist_id = v.playlist_id
          JOIN requested r ON r.video_id = v.video_id
        WHERE a.child_id = ${childId} AND a.is_available = 1
        UNION ALL
        SELECT v.video_id, v.video_title, v.video_description, v.video_thumbnail, v.duration,
          v.channel_title, v.published_at, a.content_rule, 1, 'channel', a.channel_id
        FROM allowed_channels a JOIN channel_videos v ON a.channel_id = v.channel_id
          JOIN requested r ON r.video_id = v.video_id
        WHERE a.child_id = ${childId} AND a.is_available = 1
      )
      SELECT m.video_id AS videoId, m.video_title AS videoTitle, m.video_description AS videoDescription,
        m.video_thumbnail AS videoThumbnail, m.duration, m.channel_title AS channelTitle,
        m.published_at AS publishedAt, m.content_rule AS contentRule, m.priority, m.source_kind AS sourceKind, m.source_id AS sourceId,
        o.content_rule AS overrideRule,
        EXISTS (SELECT 1 FROM allowed_playlists ap JOIN playlist_videos pv ON pv.playlist_id = ap.playlist_id
          WHERE ap.child_id = ${childId} AND ap.cartoon_pool = 1 AND ap.is_available = 1 AND pv.video_id = m.video_id) AS cartoonPool
      FROM matches m LEFT JOIN video_content_rules o ON o.child_id = ${childId} AND o.video_id = m.video_id
      WHERE (m.video_id NOT LIKE 'ol:%' OR EXISTS (
        SELECT 1 FROM provider_media pm JOIN media_providers p ON p.id = pm.provider_id
        WHERE pm.video_id = m.video_id AND p.enabled = 1
          AND (p.root_path = '/' OR pm.path = p.root_path OR substr(pm.path, 1, length(p.root_path) + 1) = p.root_path || '/')
      )) AND (m.video_id NOT LIKE 'jf:%' OR EXISTS (SELECT 1 FROM jellyfin_media jm JOIN jellyfin_servers js ON js.id = jm.server_id WHERE jm.video_id = m.video_id AND js.enabled = 1))
      ORDER BY m.priority DESC
    `)
    const grouped = new Map<string, Match[]>()
    for (const row of rows) {
      const group = grouped.get(row.videoId)
      if (group) group.push(row)
      else grouped.set(row.videoId, [row])
    }
    for (const [videoId, matches] of grouped) {
      const first = matches[0]
      const priority = first.overrideRule ? 3 : first.priority
      const rules = matches.filter(row => row.priority === priority).map(row => row.contentRule)
      if (first.overrideRule) rules.push(first.overrideRule)
      const contentRule: ContentRule = rules.includes('restricted') ? 'restricted' : 'exempt'
      const { overrideRule: _override, priority: _priority, cartoonPool: _cartoonPool, ...metadata } = first
      const explicitVideoPool = boundPool('video', videoId)
      const poolIds = first.cartoonPool ? [boundPool('cartoon', '*') ?? legacyPool('cartoon')]
        : explicitVideoPool ? [explicitVideoPool]
        : first.overrideRule ? [legacyPool(first.overrideRule)]
        : matches.filter(row => row.priority === first.priority).map(row => boundPool(row.sourceKind, row.sourceId) ?? legacyPool(row.contentRule))
      const uniquePools = [...new Set(poolIds)]
      const timePool = uniquePools.length === 1 ? pools.find(pool => pool.id === uniquePools[0]) : undefined
      result.set(videoId, {
        ...metadata, publishedAt: first.publishedAt === null ? null : new Date(first.publishedAt * 1000),
        contentRule, source: priority === 3 ? 'video' : priority === 2 ? 'playlist' : 'channel',
        usageBucket: timePool?.legacyKey ?? contentRule,
        timePoolId: timePool?.id ?? null, timePoolName: timePool?.name ?? null, timePoolConflict: uniquePools.length > 1,
        requiresClaim: Boolean(first.cartoonPool || timePool?.requiresClaim),
        supported: !matches.some(row => isShortDuration(row.duration)),
      })
    }
  }
  return result
}

export type ResolvedVideo = Omit<Match, 'publishedAt' | 'overrideRule' | 'priority' | 'cartoonPool'> & {
  timePoolId: string | null
  timePoolName: string | null
  timePoolConflict: boolean
  requiresClaim: boolean
  usageBucket: UsageBucket
  publishedAt: Date | null
  source: 'video' | 'playlist' | 'channel'
  supported: boolean
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
