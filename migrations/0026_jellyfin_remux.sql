ALTER TABLE jellyfin_servers ADD COLUMN user_id TEXT;

-- Each media resolution owns a separate Jellyfin session, so stale cleanup
-- cannot stop a replacement player. Keep rows until upstream cleanup succeeds.
CREATE TABLE jellyfin_remux_sessions (
  id TEXT PRIMARY KEY,
  authorization_id TEXT NOT NULL REFERENCES playback_sessions(id),
  server_id TEXT NOT NULL REFERENCES jellyfin_servers(id),
  play_session_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX jellyfin_remux_authorization ON jellyfin_remux_sessions(authorization_id);
