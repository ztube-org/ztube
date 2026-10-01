CREATE TABLE content_sync_jobs (
  kind TEXT NOT NULL,
  external_id TEXT NOT NULL,
  page_token TEXT,
  page_count INTEGER NOT NULL DEFAULT 0,
  playlist_id TEXT,
  title TEXT,
  thumbnail TEXT,
  last_attempt_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, external_id)
);
CREATE TABLE content_sync_pages (
  kind TEXT NOT NULL,
  external_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  request_token TEXT NOT NULL,
  videos TEXT NOT NULL,
  PRIMARY KEY (kind, external_id, page_number),
  FOREIGN KEY (kind, external_id) REFERENCES content_sync_jobs(kind, external_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX content_sync_page_token ON content_sync_pages(kind, external_id, request_token);
