ALTER TABLE child_time_settings ADD COLUMN cartoon_allowance_minutes INTEGER NOT NULL DEFAULT 30 CHECK (cartoon_allowance_minutes BETWEEN 0 AND 1440);
ALTER TABLE daily_usage_summaries ADD COLUMN cartoon_seconds INTEGER NOT NULL DEFAULT 0;

-- Rebuild both related tables to widen their usage-bucket checks without
-- cascading away existing Viewing Events when the old sessions are removed.
CREATE TABLE playback_sessions_new (
  id TEXT PRIMARY KEY NOT NULL,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  viewing_day TEXT NOT NULL,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  last_state TEXT NOT NULL DEFAULT 'paused',
  last_acknowledged_at INTEGER NOT NULL,
  ended_at INTEGER,
  lease_expires_at INTEGER NOT NULL DEFAULT 0,
  usage_bucket TEXT NOT NULL DEFAULT 'restricted' CHECK (usage_bucket IN ('restricted', 'exempt', 'cartoon')),
  video_id TEXT
);
INSERT INTO playback_sessions_new SELECT id, child_id, viewing_day, last_sequence, last_state, last_acknowledged_at, ended_at, lease_expires_at, usage_bucket, video_id FROM playback_sessions;
CREATE TABLE viewing_events_new (
  session_id TEXT PRIMARY KEY REFERENCES playback_sessions_new(id) ON DELETE CASCADE,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  video_title TEXT NOT NULL,
  channel_title TEXT,
  usage_bucket TEXT NOT NULL CHECK (usage_bucket IN ('restricted', 'exempt', 'cartoon')),
  authorized_at INTEGER NOT NULL,
  started_at INTEGER,
  last_watched_at INTEGER,
  watched_seconds INTEGER NOT NULL DEFAULT 0 CHECK (watched_seconds >= 0)
);
INSERT INTO viewing_events_new SELECT * FROM viewing_events;
DROP TABLE viewing_events;
DROP TABLE playback_sessions;
ALTER TABLE playback_sessions_new RENAME TO playback_sessions;
ALTER TABLE viewing_events_new RENAME TO viewing_events;
CREATE INDEX playback_sessions_child_id_idx ON playback_sessions(child_id);
CREATE UNIQUE INDEX one_active_playback_per_child ON playback_sessions(child_id) WHERE ended_at IS NULL;
CREATE INDEX viewing_events_child_started ON viewing_events(child_id, started_at DESC, session_id DESC);
CREATE INDEX viewing_events_retention ON viewing_events(authorized_at);
