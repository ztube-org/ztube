-- Collapse legacy duplicates before enforcing one Approved Content entry per Child.
UPDATE `allowed_channels`
SET `content_rule` = 'restricted'
WHERE EXISTS (
  SELECT 1 FROM `allowed_channels` AS duplicate
  WHERE duplicate.`child_id` = `allowed_channels`.`child_id`
    AND duplicate.`channel_id` = `allowed_channels`.`channel_id`
    AND duplicate.`content_rule` = 'restricted'
);
DELETE FROM `allowed_channels`
WHERE `id` NOT IN (SELECT MIN(`id`) FROM `allowed_channels` GROUP BY `child_id`, `channel_id`);

UPDATE `allowed_playlists`
SET `content_rule` = 'restricted'
WHERE EXISTS (
  SELECT 1 FROM `allowed_playlists` AS duplicate
  WHERE duplicate.`child_id` = `allowed_playlists`.`child_id`
    AND duplicate.`playlist_id` = `allowed_playlists`.`playlist_id`
    AND duplicate.`content_rule` = 'restricted'
);
DELETE FROM `allowed_playlists`
WHERE `id` NOT IN (SELECT MIN(`id`) FROM `allowed_playlists` GROUP BY `child_id`, `playlist_id`);

UPDATE `allowed_videos`
SET `content_rule` = 'restricted'
WHERE EXISTS (
  SELECT 1 FROM `allowed_videos` AS duplicate
  WHERE duplicate.`child_id` = `allowed_videos`.`child_id`
    AND duplicate.`video_id` = `allowed_videos`.`video_id`
    AND duplicate.`content_rule` = 'restricted'
);
DELETE FROM `allowed_videos`
WHERE `id` NOT IN (SELECT MIN(`id`) FROM `allowed_videos` GROUP BY `child_id`, `video_id`);

DELETE FROM `channel_videos`
WHERE `id` NOT IN (SELECT MAX(`id`) FROM `channel_videos` GROUP BY `channel_id`, `video_id`);
DELETE FROM `playlist_videos`
WHERE `id` NOT IN (SELECT MAX(`id`) FROM `playlist_videos` GROUP BY `playlist_id`, `video_id`);

CREATE UNIQUE INDEX `allowed_channels_child_channel` ON `allowed_channels` (`child_id`, `channel_id`);
CREATE UNIQUE INDEX `allowed_playlists_child_playlist` ON `allowed_playlists` (`child_id`, `playlist_id`);
CREATE UNIQUE INDEX `allowed_videos_child_video` ON `allowed_videos` (`child_id`, `video_id`);
CREATE UNIQUE INDEX `channel_videos_channel_video` ON `channel_videos` (`channel_id`, `video_id`);
CREATE UNIQUE INDEX `playlist_videos_playlist_video` ON `playlist_videos` (`playlist_id`, `video_id`);
CREATE INDEX `playback_sessions_child_id_idx` ON `playback_sessions` (`child_id`);

ALTER TABLE `children` ADD `avatar_url` text;

ALTER TABLE `child_time_settings` ADD `allowed_start_minute` integer DEFAULT 0 NOT NULL
  CHECK (`allowed_start_minute` BETWEEN 0 AND 1425 AND `allowed_start_minute` % 15 = 0);
ALTER TABLE `child_time_settings` ADD `allowed_end_minute` integer DEFAULT 1440 NOT NULL
  CHECK (`allowed_end_minute` BETWEEN 15 AND 1440 AND `allowed_end_minute` % 15 = 0);
ALTER TABLE `child_time_settings` ADD `break_after_minutes` integer DEFAULT 0 NOT NULL
  CHECK (`break_after_minutes` BETWEEN 0 AND 240 AND `break_after_minutes` % 15 = 0);
ALTER TABLE `child_time_settings` ADD `break_duration_minutes` integer DEFAULT 15 NOT NULL
  CHECK (`break_duration_minutes` BETWEEN 5 AND 60 AND `break_duration_minutes` % 5 = 0);

ALTER TABLE `daily_usage_summaries` ADD `playback_paused` integer DEFAULT 0 NOT NULL;
ALTER TABLE `daily_usage_summaries` ADD `break_cycle_seconds` integer DEFAULT 0 NOT NULL;
ALTER TABLE `daily_usage_summaries` ADD `break_until` integer;

ALTER TABLE `allowed_channels` ADD `tags` text DEFAULT '[]' NOT NULL;
ALTER TABLE `allowed_channels` ADD `next_page_token` text;
ALTER TABLE `allowed_playlists` ADD `tags` text DEFAULT '[]' NOT NULL;
ALTER TABLE `allowed_playlists` ADD `next_page_token` text;
ALTER TABLE `allowed_videos` ADD `tags` text DEFAULT '[]' NOT NULL;
