CREATE TABLE jellyfin_servers (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  credentials TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE jellyfin_imports (
  playlist_id TEXT PRIMARY KEY NOT NULL REFERENCES curated_playlists(id) ON DELETE CASCADE,
  server_id TEXT NOT NULL REFERENCES jellyfin_servers(id),
  item_id TEXT NOT NULL,
  last_synced_at INTEGER NOT NULL,
  UNIQUE(server_id, item_id)
);
CREATE TABLE jellyfin_media (
  video_id TEXT PRIMARY KEY NOT NULL,
  server_id TEXT NOT NULL REFERENCES jellyfin_servers(id),
  item_id TEXT NOT NULL,
  media_source_id TEXT NOT NULL,
  UNIQUE(server_id, item_id)
);
