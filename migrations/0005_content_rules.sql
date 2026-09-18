ALTER TABLE `allowed_channels` ADD `content_rule` text DEFAULT 'restricted' NOT NULL
  CHECK (`content_rule` IN ('restricted', 'exempt'));
ALTER TABLE `allowed_playlists` ADD `content_rule` text DEFAULT 'restricted' NOT NULL
  CHECK (`content_rule` IN ('restricted', 'exempt'));
ALTER TABLE `allowed_videos` ADD `content_rule` text DEFAULT 'restricted' NOT NULL
  CHECK (`content_rule` IN ('restricted', 'exempt'));
ALTER TABLE `playback_sessions` ADD `usage_bucket` text DEFAULT 'restricted' NOT NULL
  CHECK (`usage_bucket` IN ('restricted', 'exempt'));
