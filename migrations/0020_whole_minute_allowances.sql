-- Rebuild only the settings table to relax its original 15-minute CHECKs.
-- Copy every existing setting unchanged; there are no foreign keys into this table.
CREATE TABLE child_time_settings_whole_minutes (
  child_id INTEGER PRIMARY KEY NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  time_zone TEXT DEFAULT 'UTC' NOT NULL,
  weekday_allowance_minutes INTEGER DEFAULT 60 NOT NULL
    CHECK (typeof(weekday_allowance_minutes) = 'integer' AND weekday_allowance_minutes BETWEEN 0 AND 1440),
  weekend_allowance_minutes INTEGER DEFAULT 120 NOT NULL
    CHECK (typeof(weekend_allowance_minutes) = 'integer' AND weekend_allowance_minutes BETWEEN 0 AND 1440),
  safety_cap_minutes INTEGER DEFAULT 180 NOT NULL
    CHECK (typeof(safety_cap_minutes) = 'integer' AND safety_cap_minutes BETWEEN 0 AND 1440),
  updated_at INTEGER,
  allowed_start_minute INTEGER DEFAULT 0 NOT NULL
    CHECK (allowed_start_minute BETWEEN 0 AND 1425 AND allowed_start_minute % 15 = 0),
  allowed_end_minute INTEGER DEFAULT 1440 NOT NULL
    CHECK (allowed_end_minute BETWEEN 15 AND 1440 AND allowed_end_minute % 15 = 0),
  break_after_minutes INTEGER DEFAULT 0 NOT NULL
    CHECK (break_after_minutes BETWEEN 0 AND 240 AND break_after_minutes % 15 = 0),
  break_duration_minutes INTEGER DEFAULT 15 NOT NULL
    CHECK (break_duration_minutes BETWEEN 5 AND 60 AND break_duration_minutes % 5 = 0)
);
INSERT INTO child_time_settings_whole_minutes (
  child_id, time_zone, weekday_allowance_minutes, weekend_allowance_minutes, safety_cap_minutes,
  updated_at, allowed_start_minute, allowed_end_minute, break_after_minutes, break_duration_minutes
)
SELECT child_id, time_zone, weekday_allowance_minutes, weekend_allowance_minutes, safety_cap_minutes,
  updated_at, allowed_start_minute, allowed_end_minute, break_after_minutes, break_duration_minutes
FROM child_time_settings;
DROP TABLE child_time_settings;
ALTER TABLE child_time_settings_whole_minutes RENAME TO child_time_settings;
