ALTER TABLE `playback_sessions` ADD `lease_expires_at` integer DEFAULT 0 NOT NULL;

UPDATE `playback_sessions`
SET `lease_expires_at` = `last_acknowledged_at`
WHERE `lease_expires_at` = 0;

CREATE UNIQUE INDEX `one_active_playback_per_child`
ON `playback_sessions` (`child_id`)
WHERE `ended_at` IS NULL;
