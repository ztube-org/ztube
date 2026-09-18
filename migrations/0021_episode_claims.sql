ALTER TABLE allowed_playlists ADD COLUMN cartoon_pool INTEGER NOT NULL DEFAULT 0;

CREATE TABLE child_episode_settings (
  child_id INTEGER PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
  daily_limit INTEGER NOT NULL DEFAULT 1 CHECK (daily_limit IN (1, 2))
);

CREATE TABLE episode_claims (
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  viewing_day TEXT NOT NULL,
  video_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (child_id, viewing_day, video_id)
);
