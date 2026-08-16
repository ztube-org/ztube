import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Parents table
export const parents = sqliteTable('parents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Children table
export const children = sqliteTable('children', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  parentId: integer('parent_id').notNull().references(() => parents.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

export const childTimeSettings = sqliteTable('child_time_settings', {
  childId: integer('child_id').primaryKey().references(() => children.id, { onDelete: 'cascade' }),
  timeZone: text('time_zone').notNull().default('UTC'),
  weekdayAllowanceMinutes: integer('weekday_allowance_minutes').notNull().default(60),
  weekendAllowanceMinutes: integer('weekend_allowance_minutes').notNull().default(120),
  safetyCapMinutes: integer('safety_cap_minutes').notNull().default(180),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

export const dailyUsageSummaries = sqliteTable('daily_usage_summaries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  viewingDay: text('viewing_day').notNull(),
  restrictedSeconds: integer('restricted_seconds').notNull().default(0),
  exemptSeconds: integer('exempt_seconds').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
}, table => [uniqueIndex('daily_usage_child_day').on(table.childId, table.viewingDay)])

export const playbackSessions = sqliteTable('playback_sessions', {
  id: text('id').primaryKey(),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  viewingDay: text('viewing_day').notNull(),
  lastSequence: integer('last_sequence').notNull().default(0),
  lastState: text('last_state').notNull().default('paused'),
  lastAcknowledgedAt: integer('last_acknowledged_at', { mode: 'timestamp' }).notNull(),
  leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp' }).notNull(),
  usageBucket: text('usage_bucket').notNull().default('restricted'),
  endedAt: integer('ended_at', { mode: 'timestamp' }),
})

// Allowed channels
export const allowedChannels = sqliteTable('allowed_channels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  channelId: text('channel_id').notNull(),
  uploadsPlaylistId: text('uploads_playlist_id').notNull(),
  channelTitle: text('channel_title').notNull(),
  channelThumbnail: text('channel_thumbnail'),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
  isAvailable: integer('is_available', { mode: 'boolean' }).default(true),
  contentRule: text('content_rule').notNull().default('restricted'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Allowed playlists
export const allowedPlaylists = sqliteTable('allowed_playlists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  playlistId: text('playlist_id').notNull(),
  playlistTitle: text('playlist_title').notNull(),
  playlistThumbnail: text('playlist_thumbnail'),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
  isAvailable: integer('is_available', { mode: 'boolean' }).default(true),
  contentRule: text('content_rule').notNull().default('restricted'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Allowed videos
export const allowedVideos = sqliteTable('allowed_videos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  videoId: text('video_id').notNull(),
  videoTitle: text('video_title').notNull(),
  videoThumbnail: text('video_thumbnail'),
  duration: integer('duration'),
  channelTitle: text('channel_title'),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
  isAvailable: integer('is_available', { mode: 'boolean' }).default(true),
  contentRule: text('content_rule').notNull().default('restricted'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Video-specific Content Rules discovered through an approved channel or playlist.
// These are policy overrides, not duplicate standalone Approved Content cards.
export const videoContentRules = sqliteTable('video_content_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id, { onDelete: 'cascade' }),
  videoId: text('video_id').notNull(),
  contentRule: text('content_rule').notNull(),
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
  videoThumbnail: text('video_thumbnail'),
  duration: integer('duration'),
  channelTitle: text('channel_title'),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Playlist videos cache
export const playlistVideos = sqliteTable('playlist_videos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  playlistId: text('playlist_id').notNull(),
  videoId: text('video_id').notNull(),
  position: integer('position'),
  videoTitle: text('video_title').notNull(),
  videoThumbnail: text('video_thumbnail'),
  duration: integer('duration'),
  channelTitle: text('channel_title'),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Type exports
export type Parent = typeof parents.$inferSelect
export type NewParent = typeof parents.$inferInsert
export type Child = typeof children.$inferSelect
export type NewChild = typeof children.$inferInsert
export type ChildTimeSettings = typeof childTimeSettings.$inferSelect
export type AllowedChannel = typeof allowedChannels.$inferSelect
export type AllowedPlaylist = typeof allowedPlaylists.$inferSelect
export type AllowedVideo = typeof allowedVideos.$inferSelect
