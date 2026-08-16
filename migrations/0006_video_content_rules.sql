CREATE TABLE `video_content_rules` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `child_id` integer NOT NULL REFERENCES `children`(`id`) ON DELETE CASCADE,
  `video_id` text NOT NULL,
  `content_rule` text NOT NULL CHECK (`content_rule` IN ('restricted', 'exempt')),
  `video_title` text NOT NULL,
  `video_thumbnail` text,
  `duration` integer,
  `channel_title` text,
  `created_at` integer
);
CREATE UNIQUE INDEX `video_content_rules_child_video` ON `video_content_rules` (`child_id`, `video_id`);
