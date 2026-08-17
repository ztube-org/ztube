PRAGMA foreign_keys = ON;

DELETE FROM `playback_sessions`;
DELETE FROM `daily_usage_summaries`;
DELETE FROM `video_content_rules`;
DELETE FROM `allowed_videos`;
DELETE FROM `allowed_playlists`;
DELETE FROM `allowed_channels`;
DELETE FROM `child_time_settings`;
DELETE FROM `children`;
DELETE FROM `channel_videos`;
DELETE FROM `playlist_videos`;

DELETE FROM `sqlite_sequence`
WHERE `name` IN (
  'children',
  'allowed_channels',
  'allowed_playlists',
  'allowed_videos',
  'channel_videos',
  'playlist_videos',
  'daily_usage_summaries',
  'video_content_rules'
);
