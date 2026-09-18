CREATE TABLE media_providers (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  root_path TEXT NOT NULL DEFAULT '/',
  enabled INTEGER NOT NULL DEFAULT 1,
  credentials TEXT NOT NULL,
  session_token TEXT,
  revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE provider_media (
  video_id TEXT PRIMARY KEY NOT NULL,
  provider_id TEXT NOT NULL REFERENCES media_providers(id),
  path TEXT NOT NULL,
  UNIQUE(provider_id, path)
);
CREATE TABLE curated_playlists (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  write_token TEXT,
  thumbnail TEXT,
  revision INTEGER NOT NULL DEFAULT 1
);
ALTER TABLE playlist_videos ADD COLUMN season TEXT;
