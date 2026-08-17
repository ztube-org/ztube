CREATE TABLE `video_recommendations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `child_id` integer NOT NULL REFERENCES `children`(`id`) ON DELETE CASCADE,
  `video_id` text NOT NULL,
  `recommended_at` integer DEFAULT (unixepoch()),
  `seen_at` integer
);
CREATE UNIQUE INDEX `video_recommendations_child_video` ON `video_recommendations` (`child_id`, `video_id`);
