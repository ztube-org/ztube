CREATE TABLE `daily_usage_summaries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `child_id` integer NOT NULL REFERENCES `children`(`id`) ON DELETE CASCADE,
  `viewing_day` text NOT NULL,
  `restricted_seconds` integer DEFAULT 0 NOT NULL,
  `exempt_seconds` integer DEFAULT 0 NOT NULL,
  `updated_at` integer,
  UNIQUE (`child_id`, `viewing_day`)
);

CREATE TABLE `playback_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `child_id` integer NOT NULL REFERENCES `children`(`id`) ON DELETE CASCADE,
  `viewing_day` text NOT NULL,
  `last_sequence` integer DEFAULT 0 NOT NULL,
  `last_state` text DEFAULT 'paused' NOT NULL,
  `last_acknowledged_at` integer NOT NULL,
  `ended_at` integer
);
