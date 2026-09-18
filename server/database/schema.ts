import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, uniqueIndex, index, primaryKey } from 'drizzle-orm/sqlite-core'
import type { ContentRule, UsageBucket } from '../../src/domain.ts'

// Every persisted account is a Child. The Admin is configured by email and has no database profile.
export const children = sqliteTable('children', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

export const childTimeSettings = sqliteTable('child_time_settings', {
  cartoonAllowanceMinutes: integer('cartoon_allowance_minutes').notNull().default(30),
  childId: integer('child_id').primaryKey().references(() => children.id, { onDelete: 'cascade' }),
  timeZone: text('time_zone').notNull().default('UTC'),
  weekdayAllowanceMinutes: integer('weekday_allowance_minutes').notNull().default(60),
  weekendAllowanceMinutes: integer('weekend_allowance_minutes').notNull().default(120),
  safetyCapMinutes: integer('safety_cap_minutes').notNull().default(180),
  allowedStartMinute: integer('allowed_start_minute').notNull().default(0),
  allowedEndMinute: integer('allowed_end_minute').notNull().default(1440),
  breakAfterMinutes: integer('break_after_minutes').notNull().default(0),
  breakDurationMinutes: integer('break_duration_minutes').notNull().default(15),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

export const dailyUsageSummaries = sqliteTable('daily_usage_summaries', {
  cartoonSeconds: integer('cartoon_seconds').notNull().default(0),
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  viewingDay: text('viewing_day').notNull(),
  restrictedSeconds: integer('restricted_seconds').notNull().default(0),
  exemptSeconds: integer('exempt_seconds').notNull().default(0),
  restrictedExtensionMinutes: integer('restricted_extension_minutes').notNull().default(0),
  exemptExtensionMinutes: integer('exempt_extension_minutes').notNull().default(0),
  restrictedUnlocked: integer('restricted_unlocked', { mode: 'boolean' }).notNull().default(false),
  playbackPaused: integer('playback_paused', { mode: 'boolean' }).notNull().default(false),
  breakCycleSeconds: integer('break_cycle_seconds').notNull().default(0),
  breakUntil: integer('break_until', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, table => [uniqueIndex('daily_usage_child_day').on(table.childId, table.viewingDay)])

export const playbackSessions = sqliteTable('playback_sessions', {
  timePoolId: text('time_pool_id').references(() => timePools.id),
  id: text('id').primaryKey(),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  viewingDay: text('viewing_day').notNull(),
  lastSequence: integer('last_sequence').notNull().default(0),
  lastState: text('last_state').notNull().default('paused'),
  lastAcknowledgedAt: integer('last_acknowledged_at', { mode: 'timestamp' }).notNull(),
  leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp' }).notNull(),
  usageBucket: text('usage_bucket').$type<UsageBucket>().notNull().default('restricted'),
  videoId: text('video_id'),
  endedAt: integer('ended_at', { mode: 'timestamp' }),
}, table => [
  index('playback_sessions_child_id_idx').on(table.childId),
  uniqueIndex('one_active_playback_per_child').on(table.childId).where(sql`${table.endedAt} IS NULL`),
])

export const favoriteVideos = sqliteTable('favorite_videos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  videoId: text('video_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, table => [uniqueIndex('favorite_videos_child_video').on(table.childId, table.videoId)])

export const videoRecommendations = sqliteTable('video_recommendations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  videoId: text('video_id').notNull(),
  recommendedAt: integer('recommended_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
  seenAt: integer('seen_at', { mode: 'timestamp' }),
}, table => [uniqueIndex('video_recommendations_child_video').on(table.childId, table.videoId)])

export const playbackProgress = sqliteTable('playback_progress', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  videoId: text('video_id').notNull(),
  positionSeconds: integer('position_seconds').notNull(),
  duration: integer('duration').notNull(),
  videoTitle: text('video_title').notNull(),
  videoThumbnail: text('video_thumbnail'),
  channelTitle: text('channel_title'),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, table => [uniqueIndex('playback_progress_child_video').on(table.childId, table.videoId)])

// Allowed channels
export const allowedChannels = sqliteTable('allowed_channels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  channelId: text('channel_id').notNull(),
  uploadsPlaylistId: text('uploads_playlist_id').notNull(),
  channelTitle: text('channel_title').notNull(),
  channelThumbnail: text('channel_thumbnail'),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
  nextPageToken: text('next_page_token'),
  isAvailable: integer('is_available', { mode: 'boolean' }).default(true),
  contentRule: text('content_rule').$type<ContentRule>().notNull().default('restricted'),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, table => [
  index('allowed_channels_child_id_idx').on(table.childId),
  uniqueIndex('allowed_channels_child_channel').on(table.childId, table.channelId),
])

// Allowed playlists
export const allowedPlaylists = sqliteTable('allowed_playlists', {
  cartoonPool: integer('cartoon_pool', { mode: 'boolean' }).notNull().default(false),
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  playlistId: text('playlist_id').notNull(),
  playlistTitle: text('playlist_title').notNull(),
  playlistThumbnail: text('playlist_thumbnail'),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
  nextPageToken: text('next_page_token'),
  isAvailable: integer('is_available', { mode: 'boolean' }).default(true),
  contentRule: text('content_rule').$type<ContentRule>().notNull().default('restricted'),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, table => [
  index('allowed_playlists_child_id_idx').on(table.childId),
  uniqueIndex('allowed_playlists_child_playlist').on(table.childId, table.playlistId),
])

// Allowed videos
export const allowedVideos = sqliteTable('allowed_videos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  videoId: text('video_id').notNull(),
  videoTitle: text('video_title').notNull(),
  videoDescription: text('video_description'),
  videoThumbnail: text('video_thumbnail'),
  duration: integer('duration'),
  channelTitle: text('channel_title'),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
  isAvailable: integer('is_available', { mode: 'boolean' }).default(true),
  contentRule: text('content_rule').$type<ContentRule>().notNull().default('restricted'),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, table => [
  index('allowed_videos_child_id_idx').on(table.childId),
  uniqueIndex('allowed_videos_child_video').on(table.childId, table.videoId),
])

// Video-specific Content Rules discovered through an approved channel or playlist.
// These are policy overrides, not duplicate standalone Approved Content cards.
export const videoContentRules = sqliteTable('video_content_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  videoId: text('video_id').notNull(),
  contentRule: text('content_rule').$type<ContentRule>().notNull(),
  videoTitle: text('video_title').notNull(),
  videoThumbnail: text('video_thumbnail'),
  duration: integer('duration'),
  channelTitle: text('channel_title'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, table => [uniqueIndex('video_content_rules_child_video').on(table.childId, table.videoId)])

// Channel videos cache
export const channelVideos = sqliteTable('channel_videos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  channelId: text('channel_id').notNull(),
  videoId: text('video_id').notNull(),
  position: integer('position'),
  videoTitle: text('video_title').notNull(),
  videoDescription: text('video_description'),
  videoThumbnail: text('video_thumbnail'),
  duration: integer('duration'),
  channelTitle: text('channel_title'),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, table => [
  index('channel_videos_channel_id_idx').on(table.channelId),
  uniqueIndex('channel_videos_channel_video').on(table.channelId, table.videoId),
])

// Playlist videos cache
export const playlistVideos = sqliteTable('playlist_videos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  playlistId: text('playlist_id').notNull(),
  videoId: text('video_id').notNull(),
  position: integer('position'),
  season: text('season'),
  videoTitle: text('video_title').notNull(),
  videoDescription: text('video_description'),
  videoThumbnail: text('video_thumbnail'),
  duration: integer('duration'),
  channelTitle: text('channel_title'),
  publishedAt: integer('published_at', { mode: 'timestamp' }),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, table => [
  index('playlist_videos_playlist_id_idx').on(table.playlistId),
  uniqueIndex('playlist_videos_playlist_video').on(table.playlistId, table.videoId),
])

// Type exports
export type Child = typeof children.$inferSelect
export type NewChild = typeof children.$inferInsert
export type ChildTimeSettings = typeof childTimeSettings.$inferSelect
export type AllowedChannel = typeof allowedChannels.$inferSelect
export type AllowedPlaylist = typeof allowedPlaylists.$inferSelect
export type AllowedVideo = typeof allowedVideos.$inferSelect

// Admin-only viewing detail; daily aggregates retain their independent lifecycle.
export const viewingEvents = sqliteTable('viewing_events', {
  timePoolId: text('time_pool_id').references(() => timePools.id),
  timePoolName: text('time_pool_name'),
  sessionId: text('session_id').primaryKey().references(() => playbackSessions.id, { onDelete: 'cascade' }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  videoId: text('video_id').notNull(),
  videoTitle: text('video_title').notNull(),
  channelTitle: text('channel_title'),
  usageBucket: text('usage_bucket').$type<UsageBucket>().notNull(),
  authorizedAt: integer('authorized_at', { mode: 'timestamp' }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  lastWatchedAt: integer('last_watched_at', { mode: 'timestamp' }),
  watchedSeconds: integer('watched_seconds').notNull().default(0),
}, table => [
  index('viewing_events_child_started').on(table.childId, table.startedAt, table.sessionId),
  index('viewing_events_retention').on(table.authorizedAt),
])

// Connection secrets are AES-GCM envelopes; the key lives in a Worker Secret.
export const mediaProviders = sqliteTable('media_providers', {
  webdavUrl: text('webdav_url'),
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  rootPath: text('root_path').notNull().default('/'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  credentials: text('credentials').notNull(),
  sessionToken: text('session_token'),
  revision: integer('revision').notNull().default(1),
})
export const providerMedia = sqliteTable('provider_media', {
  videoId: text('video_id').primaryKey(),
  providerId: text('provider_id').notNull().references(() => mediaProviders.id),
  path: text('path').notNull(),
}, table => [uniqueIndex('provider_media_path').on(table.providerId, table.path)])
export const curatedPlaylists = sqliteTable('curated_playlists', {
  writeToken: text('write_token'),
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  thumbnail: text('thumbnail'),
  revision: integer('revision').notNull().default(1),
})

export const childEpisodeSettings = sqliteTable('child_episode_settings', {
  childId: integer('child_id').primaryKey().references(() => children.id, { onDelete: 'cascade' }),
  dailyLimit: integer('daily_limit').notNull().default(1),
})

export const episodeCreditGrants = sqliteTable('episode_credit_grants', {
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  requestId: text('request_id').notNull(),
  viewingDay: text('viewing_day').notNull(),
  grantedBy: integer('granted_by').references(() => children.id, { onDelete: 'set null' }),
  grantedAt: integer('granted_at', { mode: 'timestamp' }).notNull(),
}, table => [primaryKey({ columns: [table.childId, table.requestId] }), index('episode_credit_grants_day').on(table.childId, table.viewingDay)])

export const episodeUnlocks = sqliteTable('episode_unlocks', {
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  videoId: text('video_id').notNull(),
  unlockedAt: integer('unlocked_at', { mode: 'timestamp' }).notNull(),
}, table => [primaryKey({ columns: [table.childId, table.videoId] })])

export const episodeClaims = sqliteTable('episode_claims', {
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  viewingDay: text('viewing_day').notNull(),
  videoId: text('video_id').notNull(),
  claimedAt: integer('claimed_at', { mode: 'timestamp' }).notNull(),
}, table => [primaryKey({ columns: [table.childId, table.viewingDay, table.videoId] })])

export const timePools = sqliteTable('time_pools', {
  id: text('id').primaryKey(),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  weekdayMinutes: integer('weekday_minutes').notNull(),
  weekendMinutes: integer('weekend_minutes').notNull(),
  requiresClaim: integer('requires_claim', { mode: 'boolean' }).notNull().default(false),
  legacyKey: text('legacy_key').$type<UsageBucket>(),
}, table => [uniqueIndex('time_pools_child_id').on(table.childId, table.id), uniqueIndex('time_pools_child_legacy').on(table.childId, table.legacyKey)])

export const timePoolUsage = sqliteTable('time_pool_usage', {
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  poolId: text('pool_id').notNull().references(() => timePools.id, { onDelete: 'cascade' }),
  viewingDay: text('viewing_day').notNull(),
  usedSeconds: integer('used_seconds').notNull().default(0),
  extensionMinutes: integer('extension_minutes').notNull().default(0),
  unlocked: integer('unlocked', { mode: 'boolean' }).notNull().default(false),
}, table => [primaryKey({ columns: [table.poolId, table.viewingDay] })])

export const timePoolBindings = sqliteTable('time_pool_bindings', {
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'channel' | 'playlist' | 'video' | 'cartoon'>().notNull(),
  contentId: text('content_id').notNull(),
  poolId: text('pool_id').notNull().references(() => timePools.id),
}, table => [primaryKey({ columns: [table.childId, table.kind, table.contentId] })])

export const jellyfinServers = sqliteTable('jellyfin_servers', {
  userId: text('user_id'),
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  credentials: text('credentials').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  revision: integer('revision').notNull().default(1),
})
export const jellyfinImports = sqliteTable('jellyfin_imports', {
  playlistId: text('playlist_id').primaryKey().references(() => curatedPlaylists.id, { onDelete: 'cascade' }),
  serverId: text('server_id').notNull().references(() => jellyfinServers.id),
  itemId: text('item_id').notNull(),
  lastSyncedAt: integer('last_synced_at', { mode: 'timestamp' }).notNull(),
}, table => [uniqueIndex('jellyfin_import_source').on(table.serverId, table.itemId)])
export const jellyfinMedia = sqliteTable('jellyfin_media', {
  videoId: text('video_id').primaryKey(),
  serverId: text('server_id').notNull().references(() => jellyfinServers.id),
  itemId: text('item_id').notNull(),
  mediaSourceId: text('media_source_id').notNull(),
}, table => [uniqueIndex('jellyfin_media_source').on(table.serverId, table.itemId)])
