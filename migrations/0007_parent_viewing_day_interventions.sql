ALTER TABLE `daily_usage_summaries` ADD `restricted_extension_minutes` integer DEFAULT 0 NOT NULL;
ALTER TABLE `daily_usage_summaries` ADD `exempt_extension_minutes` integer DEFAULT 0 NOT NULL;
ALTER TABLE `daily_usage_summaries` ADD `restricted_unlocked` integer DEFAULT 0 NOT NULL;
