DELETE FROM allowed_playlists WHERE playlist_id GLOB 'pl:*' AND playlist_id NOT GLOB 'pl:jf:*';
DELETE FROM playlist_videos WHERE (playlist_id GLOB 'pl:*' AND playlist_id NOT GLOB 'pl:jf:*') OR video_id GLOB 'ol:*';
DELETE FROM curated_playlists WHERE id GLOB 'pl:*' AND id NOT GLOB 'pl:jf:*';
DELETE FROM channel_videos WHERE video_id GLOB 'ol:*';
DELETE FROM allowed_videos WHERE video_id GLOB 'ol:*';
DELETE FROM video_content_rules WHERE video_id GLOB 'ol:*';
DELETE FROM time_pool_bindings
WHERE (kind = 'playlist' AND content_id GLOB 'pl:*' AND content_id NOT GLOB 'pl:jf:*')
   OR (kind = 'video' AND content_id GLOB 'ol:*');
DELETE FROM favorite_videos WHERE video_id GLOB 'ol:*';
DELETE FROM playback_progress WHERE video_id GLOB 'ol:*';
DELETE FROM video_recommendations WHERE video_id GLOB 'ol:*';
DELETE FROM content_sync_jobs
WHERE (kind = 'playlist' AND external_id GLOB 'pl:*' AND external_id NOT GLOB 'pl:jf:*')
   OR (kind = 'video' AND external_id GLOB 'ol:*');

UPDATE playback_sessions
SET last_state = 'ended', ended_at = coalesce(ended_at, last_acknowledged_at), video_id = NULL
WHERE video_id GLOB 'ol:*';

DROP TABLE IF EXISTS provider_media;
DROP TABLE IF EXISTS media_providers;
