-- Null endpoints retain the existing OpenList origin + /dav/ mapping.
-- Keep legacy columns for application rollback; media IDs and paths do not change.
ALTER TABLE media_providers ADD COLUMN webdav_url TEXT;
