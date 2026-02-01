import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// Parents table
export const parents = sqliteTable('parents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Children table
export const children = sqliteTable('children', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  parentId: integer('parent_id').notNull().references(() => parents.id),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Allowed channels
export const allowedChannels = sqliteTable('allowed_channels', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id),
  channelId: text('channel_id').notNull(),
  channelTitle: text('channel_title').notNull(),
  channelThumbnail: text('channel_thumbnail'),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
  isAvailable: integer('is_available', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Allowed playlists
export const allowedPlaylists = sqliteTable('allowed_playlists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id),
  playlistId: text('playlist_id').notNull(),
  playlistTitle: text('playlist_title').notNull(),
  playlistThumbnail: text('playlist_thumbnail'),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
  isAvailable: integer('is_available', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

// Allowed videos
export const allowedVideos = sqliteTable('allowed_videos', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  childId: integer('child_id').notNull().references(() => children.id),
  videoId: text('video_id').notNull(),
  videoTitle: text('video_title').notNull(),
  videoThumbnail: text('video_thumbnail'),
  duration: integer('duration'),
  channelTitle: text('channel_title'),
  lastFetchedAt: integer('last_fetched_at', { mode: 'timestamp' }),
  isAvailable: integer('is_available', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

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
export type AllowedChannel = typeof allowedChannels.$inferSelect
export type AllowedPlaylist = typeof allowedPlaylists.$inferSelect
export type AllowedVideo = typeof allowedVideos.$inferSelect
