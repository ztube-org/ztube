PRAGMA foreign_keys = ON;

CREATE TABLE `parents` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `email` text NOT NULL UNIQUE,
  `display_name` text,
  `created_at` integer
);

CREATE TABLE `children` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `parent_id` integer NOT NULL REFERENCES `parents`(`id`) ON DELETE CASCADE,
  `email` text NOT NULL UNIQUE,
  `display_name` text,
  `created_at` integer
);

CREATE TABLE `allowed_channels` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `child_id` integer NOT NULL REFERENCES `children`(`id`) ON DELETE CASCADE,
  `channel_id` text NOT NULL,
  `uploads_playlist_id` text NOT NULL,
  `channel_title` text NOT NULL,
  `channel_thumbnail` text,
  `last_fetched_at` integer,
  `is_available` integer DEFAULT true,
  `created_at` integer
);

CREATE TABLE `allowed_playlists` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `child_id` integer NOT NULL REFERENCES `children`(`id`) ON DELETE CASCADE,
  `playlist_id` text NOT NULL,
  `playlist_title` text NOT NULL,
  `playlist_thumbnail` text,
  `last_fetched_at` integer,
  `is_available` integer DEFAULT true,
  `created_at` integer
);

CREATE TABLE `allowed_videos` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `child_id` integer NOT NULL REFERENCES `children`(`id`) ON DELETE CASCADE,
  `video_id` text NOT NULL,
  `video_title` text NOT NULL,
  `video_thumbnail` text,
  `duration` integer,
  `channel_title` text,
  `last_fetched_at` integer,
  `is_available` integer DEFAULT true,
  `created_at` integer
);

CREATE TABLE `channel_videos` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `channel_id` text NOT NULL,
  `video_id` text NOT NULL,
  `position` integer,
  `video_title` text NOT NULL,
  `video_thumbnail` text,
  `duration` integer,
  `channel_title` text,
  `fetched_at` integer
);

CREATE TABLE `playlist_videos` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `playlist_id` text NOT NULL,
  `video_id` text NOT NULL,
  `position` integer,
  `video_title` text NOT NULL,
  `video_thumbnail` text,
  `duration` integer,
  `channel_title` text,
  `fetched_at` integer
);

CREATE INDEX `children_parent_id_idx` ON `children` (`parent_id`);
CREATE INDEX `allowed_channels_child_id_idx` ON `allowed_channels` (`child_id`);
CREATE INDEX `allowed_playlists_child_id_idx` ON `allowed_playlists` (`child_id`);
CREATE INDEX `allowed_videos_child_id_idx` ON `allowed_videos` (`child_id`);
CREATE INDEX `channel_videos_channel_id_idx` ON `channel_videos` (`channel_id`);
CREATE INDEX `playlist_videos_playlist_id_idx` ON `playlist_videos` (`playlist_id`);
