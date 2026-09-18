CREATE TABLE viewing_events (
  session_id TEXT PRIMARY KEY REFERENCES playback_sessions(id) ON DELETE CASCADE,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  video_title TEXT NOT NULL,
  channel_title TEXT,
  usage_bucket TEXT NOT NULL CHECK (usage_bucket IN ('restricted', 'exempt')),
  authorized_at INTEGER NOT NULL,
  started_at INTEGER,
  last_watched_at INTEGER,
  watched_seconds INTEGER NOT NULL DEFAULT 0 CHECK (watched_seconds >= 0)
);
CREATE INDEX viewing_events_child_started ON viewing_events(child_id, started_at DESC, session_id DESC);
CREATE INDEX viewing_events_retention ON viewing_events(authorized_at);
