CREATE TABLE time_pools (
  id TEXT PRIMARY KEY NOT NULL,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  weekday_minutes INTEGER NOT NULL CHECK (weekday_minutes BETWEEN 0 AND 1440),
  weekend_minutes INTEGER NOT NULL CHECK (weekend_minutes BETWEEN 0 AND 1440),
  requires_claim INTEGER NOT NULL DEFAULT 0,
  legacy_key TEXT CHECK (legacy_key IN ('restricted', 'exempt', 'cartoon')),
  UNIQUE(child_id, id), UNIQUE(child_id, legacy_key)
);
CREATE TABLE time_pool_usage (
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  pool_id TEXT NOT NULL,
  viewing_day TEXT NOT NULL,
  used_seconds INTEGER NOT NULL DEFAULT 0,
  extension_minutes INTEGER NOT NULL DEFAULT 0,
  unlocked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(pool_id, viewing_day),
  FOREIGN KEY(child_id, pool_id) REFERENCES time_pools(child_id, id) ON DELETE CASCADE
);
CREATE TABLE time_pool_bindings (
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('channel', 'playlist', 'video', 'cartoon')),
  content_id TEXT NOT NULL,
  pool_id TEXT NOT NULL,
  PRIMARY KEY(child_id, kind, content_id),
  FOREIGN KEY(child_id, pool_id) REFERENCES time_pools(child_id, id)
);
ALTER TABLE playback_sessions ADD COLUMN time_pool_id TEXT REFERENCES time_pools(id);
ALTER TABLE viewing_events ADD COLUMN time_pool_id TEXT REFERENCES time_pools(id);
ALTER TABLE viewing_events ADD COLUMN time_pool_name TEXT;

INSERT INTO time_pools SELECT 'pool:' || c.id || ':restricted', c.id, 'General videos', COALESCE(s.weekday_allowance_minutes, 60), COALESCE(s.weekend_allowance_minutes, 120), 0, 'restricted' FROM children c LEFT JOIN child_time_settings s ON s.child_id = c.id;
INSERT INTO time_pool_usage SELECT child_id, 'pool:' || child_id || ':restricted', viewing_day, restricted_seconds, restricted_extension_minutes, restricted_unlocked FROM daily_usage_summaries;
INSERT INTO time_pools SELECT 'pool:' || c.id || ':exempt', c.id, 'Learning', COALESCE(s.safety_cap_minutes, 180), COALESCE(s.safety_cap_minutes, 180), 0, 'exempt' FROM children c LEFT JOIN child_time_settings s ON s.child_id = c.id;
INSERT INTO time_pool_usage SELECT child_id, 'pool:' || child_id || ':exempt', viewing_day, exempt_seconds, exempt_extension_minutes, 0 FROM daily_usage_summaries;
INSERT INTO time_pools SELECT 'pool:' || c.id || ':cartoon', c.id, 'Cartoons', COALESCE(s.cartoon_allowance_minutes, 30), COALESCE(s.cartoon_allowance_minutes, 30), 1, 'cartoon' FROM children c LEFT JOIN child_time_settings s ON s.child_id = c.id;
INSERT INTO time_pool_usage SELECT child_id, 'pool:' || child_id || ':cartoon', viewing_day, cartoon_seconds, 0, 0 FROM daily_usage_summaries;
UPDATE playback_sessions SET time_pool_id = 'pool:' || child_id || ':' || usage_bucket;
UPDATE viewing_events SET time_pool_id = 'pool:' || child_id || ':' || usage_bucket, time_pool_name = (SELECT name FROM time_pools WHERE id = 'pool:' || viewing_events.child_id || ':' || usage_bucket);

-- Initialize presets for newly provisioned Children.
CREATE TRIGGER time_pools_initialize AFTER INSERT ON child_time_settings BEGIN
 INSERT INTO time_pools VALUES ('pool:' || NEW.child_id || ':restricted', NEW.child_id, 'General videos', NEW.weekday_allowance_minutes, NEW.weekend_allowance_minutes, 0, 'restricted') ON CONFLICT(id) DO UPDATE SET weekday_minutes = excluded.weekday_minutes, weekend_minutes = excluded.weekend_minutes;
 INSERT INTO time_pool_usage SELECT child_id, 'pool:' || child_id || ':restricted', viewing_day, restricted_seconds, restricted_extension_minutes, restricted_unlocked FROM daily_usage_summaries WHERE child_id = NEW.child_id ON CONFLICT DO NOTHING;
 INSERT INTO time_pools VALUES ('pool:' || NEW.child_id || ':exempt', NEW.child_id, 'Learning', NEW.safety_cap_minutes, NEW.safety_cap_minutes, 0, 'exempt') ON CONFLICT(id) DO UPDATE SET weekday_minutes = excluded.weekday_minutes, weekend_minutes = excluded.weekend_minutes;
 INSERT INTO time_pool_usage SELECT child_id, 'pool:' || child_id || ':exempt', viewing_day, exempt_seconds, exempt_extension_minutes, 0 FROM daily_usage_summaries WHERE child_id = NEW.child_id ON CONFLICT DO NOTHING;
 INSERT INTO time_pools VALUES ('pool:' || NEW.child_id || ':cartoon', NEW.child_id, 'Cartoons', NEW.cartoon_allowance_minutes, NEW.cartoon_allowance_minutes, 1, 'cartoon') ON CONFLICT(id) DO UPDATE SET weekday_minutes = excluded.weekday_minutes, weekend_minutes = excluded.weekend_minutes;
 INSERT INTO time_pool_usage SELECT child_id, 'pool:' || child_id || ':cartoon', viewing_day, cartoon_seconds, 0, 0 FROM daily_usage_summaries WHERE child_id = NEW.child_id ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER time_pool_settings_restricted AFTER UPDATE OF weekday_allowance_minutes, weekend_allowance_minutes ON child_time_settings
WHEN NEW.weekday_allowance_minutes != OLD.weekday_allowance_minutes OR NEW.weekend_allowance_minutes != OLD.weekend_allowance_minutes BEGIN
 UPDATE time_pools SET weekday_minutes = NEW.weekday_allowance_minutes, weekend_minutes = NEW.weekend_allowance_minutes WHERE child_id = NEW.child_id AND legacy_key = 'restricted';
END;
CREATE TRIGGER time_pool_settings_exempt AFTER UPDATE OF safety_cap_minutes ON child_time_settings
WHEN NEW.safety_cap_minutes != OLD.safety_cap_minutes OR NEW.safety_cap_minutes != OLD.safety_cap_minutes BEGIN
 UPDATE time_pools SET weekday_minutes = NEW.safety_cap_minutes, weekend_minutes = NEW.safety_cap_minutes WHERE child_id = NEW.child_id AND legacy_key = 'exempt';
END;
CREATE TRIGGER time_pool_settings_cartoon AFTER UPDATE OF cartoon_allowance_minutes ON child_time_settings
WHEN NEW.cartoon_allowance_minutes != OLD.cartoon_allowance_minutes OR NEW.cartoon_allowance_minutes != OLD.cartoon_allowance_minutes BEGIN
 UPDATE time_pools SET weekday_minutes = NEW.cartoon_allowance_minutes, weekend_minutes = NEW.cartoon_allowance_minutes WHERE child_id = NEW.child_id AND legacy_key = 'cartoon';
END;
CREATE TRIGGER time_pool_legacy_usage_insert AFTER INSERT ON daily_usage_summaries BEGIN
 INSERT INTO time_pool_usage SELECT NEW.child_id, id, NEW.viewing_day, NEW.restricted_seconds, NEW.restricted_extension_minutes, NEW.restricted_unlocked FROM time_pools WHERE child_id = NEW.child_id AND legacy_key = 'restricted' ON CONFLICT(pool_id, viewing_day) DO NOTHING;
 INSERT INTO time_pool_usage SELECT NEW.child_id, id, NEW.viewing_day, NEW.exempt_seconds, NEW.exempt_extension_minutes, 0 FROM time_pools WHERE child_id = NEW.child_id AND legacy_key = 'exempt' ON CONFLICT(pool_id, viewing_day) DO NOTHING;
 INSERT INTO time_pool_usage SELECT NEW.child_id, id, NEW.viewing_day, NEW.cartoon_seconds, 0, 0 FROM time_pools WHERE child_id = NEW.child_id AND legacy_key = 'cartoon' ON CONFLICT(pool_id, viewing_day) DO NOTHING;
END;
CREATE TRIGGER time_pool_legacy_usage_update AFTER UPDATE ON daily_usage_summaries BEGIN
 INSERT INTO time_pool_usage SELECT NEW.child_id, id, NEW.viewing_day, NEW.restricted_seconds, NEW.restricted_extension_minutes, NEW.restricted_unlocked FROM time_pools WHERE child_id = NEW.child_id AND legacy_key = 'restricted' ON CONFLICT(pool_id, viewing_day) DO UPDATE SET used_seconds = excluded.used_seconds, extension_minutes = excluded.extension_minutes, unlocked = excluded.unlocked WHERE used_seconds != excluded.used_seconds OR extension_minutes != excluded.extension_minutes OR unlocked != excluded.unlocked;
 INSERT INTO time_pool_usage SELECT NEW.child_id, id, NEW.viewing_day, NEW.exempt_seconds, NEW.exempt_extension_minutes, 0 FROM time_pools WHERE child_id = NEW.child_id AND legacy_key = 'exempt' ON CONFLICT(pool_id, viewing_day) DO UPDATE SET used_seconds = excluded.used_seconds, extension_minutes = excluded.extension_minutes, unlocked = excluded.unlocked WHERE used_seconds != excluded.used_seconds OR extension_minutes != excluded.extension_minutes OR unlocked != excluded.unlocked;
 INSERT INTO time_pool_usage SELECT NEW.child_id, id, NEW.viewing_day, NEW.cartoon_seconds, 0, 0 FROM time_pools WHERE child_id = NEW.child_id AND legacy_key = 'cartoon' ON CONFLICT(pool_id, viewing_day) DO UPDATE SET used_seconds = excluded.used_seconds WHERE used_seconds != excluded.used_seconds;
END;
CREATE TRIGGER time_pool_usage_projection_insert AFTER INSERT ON time_pool_usage BEGIN
 INSERT INTO daily_usage_summaries (child_id, viewing_day) VALUES (NEW.child_id, NEW.viewing_day) ON CONFLICT DO NOTHING;
 UPDATE daily_usage_summaries SET restricted_seconds = NEW.used_seconds, restricted_extension_minutes = NEW.extension_minutes, restricted_unlocked = NEW.unlocked WHERE child_id = NEW.child_id AND viewing_day = NEW.viewing_day AND (restricted_seconds != NEW.used_seconds OR restricted_extension_minutes != NEW.extension_minutes OR restricted_unlocked != NEW.unlocked) AND EXISTS (SELECT 1 FROM time_pools WHERE id = NEW.pool_id AND legacy_key = 'restricted');
 UPDATE daily_usage_summaries SET exempt_seconds = NEW.used_seconds, exempt_extension_minutes = NEW.extension_minutes WHERE child_id = NEW.child_id AND viewing_day = NEW.viewing_day AND (exempt_seconds != NEW.used_seconds OR exempt_extension_minutes != NEW.extension_minutes) AND EXISTS (SELECT 1 FROM time_pools WHERE id = NEW.pool_id AND legacy_key = 'exempt');
 UPDATE daily_usage_summaries SET cartoon_seconds = NEW.used_seconds WHERE child_id = NEW.child_id AND viewing_day = NEW.viewing_day AND (cartoon_seconds != NEW.used_seconds) AND EXISTS (SELECT 1 FROM time_pools WHERE id = NEW.pool_id AND legacy_key = 'cartoon');
END;
CREATE TRIGGER time_pool_usage_projection_update AFTER UPDATE ON time_pool_usage BEGIN
 INSERT INTO daily_usage_summaries (child_id, viewing_day) VALUES (NEW.child_id, NEW.viewing_day) ON CONFLICT DO NOTHING;
 UPDATE daily_usage_summaries SET restricted_seconds = NEW.used_seconds, restricted_extension_minutes = NEW.extension_minutes, restricted_unlocked = NEW.unlocked WHERE child_id = NEW.child_id AND viewing_day = NEW.viewing_day AND (restricted_seconds != NEW.used_seconds OR restricted_extension_minutes != NEW.extension_minutes OR restricted_unlocked != NEW.unlocked) AND EXISTS (SELECT 1 FROM time_pools WHERE id = NEW.pool_id AND legacy_key = 'restricted');
 UPDATE daily_usage_summaries SET exempt_seconds = NEW.used_seconds, exempt_extension_minutes = NEW.extension_minutes WHERE child_id = NEW.child_id AND viewing_day = NEW.viewing_day AND (exempt_seconds != NEW.used_seconds OR exempt_extension_minutes != NEW.extension_minutes) AND EXISTS (SELECT 1 FROM time_pools WHERE id = NEW.pool_id AND legacy_key = 'exempt');
 UPDATE daily_usage_summaries SET cartoon_seconds = NEW.used_seconds WHERE child_id = NEW.child_id AND viewing_day = NEW.viewing_day AND (cartoon_seconds != NEW.used_seconds) AND EXISTS (SELECT 1 FROM time_pools WHERE id = NEW.pool_id AND legacy_key = 'cartoon');
END;

CREATE TRIGGER time_pools_new_child AFTER INSERT ON children BEGIN
 INSERT INTO time_pools VALUES ('pool:' || NEW.id || ':restricted', NEW.id, 'General videos', 60, 120, 0, 'restricted');
 INSERT INTO time_pools VALUES ('pool:' || NEW.id || ':exempt', NEW.id, 'Learning', 180, 180, 0, 'exempt');
 INSERT INTO time_pools VALUES ('pool:' || NEW.id || ':cartoon', NEW.id, 'Cartoons', 30, 30, 1, 'cartoon');
END;
