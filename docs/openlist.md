# WebDAV Providers and shared Playlists

Open **Admin → Providers & Playlists** (`/admin/library`). Provider connections use standard WebDAV, including OpenList's WebDAV endpoint. ZTube no longer calls OpenList's JSON login, directory or file APIs.

1. Add a WebDAV Provider with its complete public HTTPS endpoint, username, password and optional root directory. For OpenList, use `https://olist.example.com/dav/` and enable the account's **WebDAV read** permission. Set the storage's WebDAV policy to **302 redirect**. Other WebDAV servers can use their own endpoint paths, including `/remote.php/dav/files/<user>/`.
2. If Cloudflare Access protects the endpoint, add the service authentication headers configured for that Access application. Standard configuration uses `CF-Access-Client-Id` and `CF-Access-Client-Secret`. A custom single header must match Access's configured header name and contain its required JSON service-token value. `Authorization` is reserved for WebDAV Basic Auth. The Access policy action must be **Service Auth**.
3. Choose the Provider in the file picker and select **Browse / test**. Directory paths are relative to the configured WebDAV endpoint; in OpenList they remain relative to the account's BasePath. Adding a Provider grants no Child access.
4. Select MP4 episodes, set a season label, and add them to the draft. Files are sorted naturally (1, 2, 10). ZTube automatically reads each video's duration without playing it; no manual duration or individual Preview is required. Metadata loads run at most three at a time, with a 30-second timeout per file and cleanup on completion or leaving the editor. Failed files show a retry action; retry or remove them before saving. Videos must exceed 180 seconds and be at most 24 hours. Edit title, artwork URL, season labels and episode order, then save. The Save button explains any missing title, pending metadata or invalid episode.
5. Share the saved Playlist with each Child using independent Pool Bindings and tags. Saved changes affect all Children shown in the editor. Removing one approval does not remove access granted by another Playlist. An explicit video Pool Binding takes priority over playlist and channel bindings.

Children use the existing Playlists shelf, season selection, ordered episodes, Continue Watching, Favorites and explicit Next episode. Every playback and episode transition uses the existing server authorization, single active session, heartbeat ledger, Viewing Window, Required Break and allowance rules. Episodes do not become standalone Videos shelf entries.

## WebDAV requests and credentials

- Directory browsing sends `PROPFIND` with `Depth: 1` and requests `DAV:resourcetype` and `DAV:getcontentlength`. A namespace-aware XML parser reads successful properties from `207 Multi-Status`. It rejects DTDs, malformed XML, foreign/out-of-scope hrefs and nested descendants.
- WebDAV does not define standard directory pagination. ZTube sorts the returned directory and presents 100 files per UI page. Each page reads the directory afresh; responses are limited to 4 MB and 10,000 entries. Choose a smaller root for larger directories.
- Playback resolution sends `GET` with `Range: bytes=0-0`, follows bounded redirects manually, and cancels each response body rather than buffering the video. The final URL must respond successfully without account credentials or custom headers.
- Basic Auth and custom headers are sent only within the configured WebDAV endpoint. Once a redirect leaves that boundary, credentials are never reattached, including if a later redirect returns to the original server. Cloudflare Access login redirects are diagnosed separately.
- Passwords and custom header values use AES-GCM encryption in D1/SQLite, bound to the Provider ID. `PROVIDER_ENCRYPTION_KEY` is a base64-encoded 32-byte Worker Secret outside D1. Preserve it with deployment credentials; restoring D1 alone cannot decrypt settings.
- Read responses expose only header names and saved-value indicators. Blank password/header values retain existing secrets; remove a header row to clear it. Changing the endpoint requires re-entering credentials. A Provider already referenced by Playlists cannot change its endpoint or username: add a new Provider to avoid substituting content at approved paths.
- Temporary media URLs are resolved through a Child-owned live Playback Authorization. Approval, Provider state and viewing policy are checked before and after resolution. URLs are not stored in D1; Provider credentials never go to the Child or download host.
- Disable a Provider to stop new authorizations and revoke active playback at the next heartbeat. Other Providers and YouTube remain independent. Scheduled YouTube synchronization skips curated Playlists.
- Shared Playlist saves are transactional and reject stale revisions. Media IDs remain stable for the same Provider and path. Moving a file requires selecting its new path; replacing a file at the same path replaces what that approved entry plays.

## Playback boundaries

WebDAV itself does **not** require a 302 response. Servers can stream files directly using Basic Auth. ZTube currently supports WebDAV libraries whose files resolve to HTTPS video URLs that a browser can read without those credentials, including OpenList's 302 mode and publicly readable WebDAV files. An authenticated-only stream produces a clear error; ZTube does not proxy video or embed credentials in browser URLs. A final URL accessible from the server may still be unusable from the Child's network if the storage applies IP binding or other restrictions.

Up to 200 explicitly selected episodes per Playlist. New files never enter Playlists automatically. Initial media support is MP4 with browser-compatible codecs, preferably H.264/AAC; no transcoding is provided. Preview actual files on the target iPad. Playback controls apply inside ZTube; a copied signed media URL is a bearer link that ZTube cannot revoke after issuance.

## Upgrade from the OpenList JSON API

Migration `0019_webdav_endpoint.sql` adds a nullable endpoint column. Existing Providers default to their previous origin plus `/dav/`; existing account credentials, custom headers, root paths, Provider/media IDs, shared Playlists and Child approvals remain intact. Legacy session tokens are no longer read, refreshed or used. The previous OpenList-specific directory-password setting is not part of WebDAV; directory access follows the WebDAV account's permissions.

For self-hosted installations, set `PROVIDER_ENCRYPTION_KEY` with `npx wrangler secret put PROVIDER_ENCRYPTION_KEY` using a securely retained random 32-byte base64 key. Use a separate key in ignored `.dev.vars` for local development. YouTube works without the Provider encryption key.

Protocol references: [WebDAV RFC 4918](https://www.rfc-editor.org/rfc/rfc4918), [OpenList WebDAV authentication](https://github.com/OpenListTeam/OpenList/blob/main/server/webdav.go), [OpenList redirect handling](https://github.com/OpenListTeam/OpenList/blob/main/server/webdav/webdav.go). Actual storage/account settings determine whether WebDAV returns a direct URL.
