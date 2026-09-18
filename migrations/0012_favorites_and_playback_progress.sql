ALTER TABLE `playback_sessions` ADD `video_id` text;

CREATE TABLE `favorite_videos` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `child_id` integer NOT NULL REFERENCES `children`(`id`) ON DELETE CASCADE,
  `video_id` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX `favorite_videos_child_video` ON `favorite_videos` (`child_id`, `video_id`);

CREATE TABLE `playback_progress` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `child_id` integer NOT NULL REFERENCES `children`(`id`) ON DELETE CASCADE,
  `video_id` text NOT NULL,
  `position_seconds` integer NOT NULL,
  `duration` integer NOT NULL,
  `video_title` text NOT NULL,
  `video_thumbnail` text,
  `channel_title` text,
  `published_at` integer,
  `updated_at` integer DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX `playback_progress_child_video` ON `playback_progress` (`child_id`, `video_id`);
