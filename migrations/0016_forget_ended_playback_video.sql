-- A video identity is needed only while its Playback Authorization is active.
-- Finished sessions retain lease/accounting metadata but never viewing history.
UPDATE `playback_sessions`
SET `video_id` = NULL,
    `last_state` = CASE WHEN `lease_expires_at` <= unixepoch() THEN 'ended' ELSE `last_state` END,
    `ended_at` = CASE WHEN `lease_expires_at` <= unixepoch() THEN COALESCE(`ended_at`, `lease_expires_at`) ELSE `ended_at` END
WHERE `ended_at` IS NOT NULL OR `lease_expires_at` <= unixepoch();
