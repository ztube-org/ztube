CREATE TABLE `child_time_settings` (
  `child_id` integer PRIMARY KEY NOT NULL REFERENCES `children`(`id`) ON DELETE CASCADE,
  `time_zone` text DEFAULT 'UTC' NOT NULL,
  `weekday_allowance_minutes` integer DEFAULT 60 NOT NULL,
  `weekend_allowance_minutes` integer DEFAULT 120 NOT NULL,
  `safety_cap_minutes` integer DEFAULT 180 NOT NULL,
  `updated_at` integer,
  CHECK (`weekday_allowance_minutes` BETWEEN 0 AND 1440 AND `weekday_allowance_minutes` % 15 = 0),
  CHECK (`weekend_allowance_minutes` BETWEEN 0 AND 1440 AND `weekend_allowance_minutes` % 15 = 0),
  CHECK (`safety_cap_minutes` BETWEEN 0 AND 1440 AND `safety_cap_minutes` % 15 = 0)
);

INSERT INTO `child_time_settings` (`child_id`, `time_zone`)
SELECT `id`, 'UTC' FROM `children`;
