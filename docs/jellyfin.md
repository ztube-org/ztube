# Jellyfin library

Connect a Jellyfin server to import series or seasons into shared Playlists.
ZTube handles metadata and playback authorization; browsers download media
directly from Jellyfin.

## Set up

1. Apply all D1 migrations before deploying the Worker.
   Migration 0023 supplies the configurable Time Pools used by this integration.
2. Set `PROVIDER_ENCRYPTION_KEY` as described in the [README](../README.md#4-set-your-worker-secrets), or keep the existing key. Jellyfin keys use the
   same AES-GCM credential envelope as WebDAV; no additional Worker secret is required.
   Do not replace an existing encryption key when adding a connection.
3. In Jellyfin's Dashboard, create an API key for ZTube.
4. In ZTube, open **Manage Jellyfin library** and **Add Jellyfin server**. Enter the
   server's HTTPS base URL and API key. Preserve any base path, for example
   `https://media.example.com/jellyfin/`. Saving does not contact the server;
   **Browse library** performs the first connection attempt.
5. Choose a TV library, series and optionally a season. **Import series** includes
   all seasons; **Import season** includes only that season. Episode metadata and
   order come from Jellyfin. Unsupported episodes are skipped and counted in the result.
6. Under **Imported series & seasons**, select the Children whose Cartoon Pool
   should include the import. Follow the Child settings link to choose the cartoon
   library's Time Pool and one or two unlock credits per day. The default cartoon pool has
   30 minutes per day and is independent of General videos and Learning.

Removing a Child's selection removes that Playlist approval. If another approved
import contains the same episode, that other approval continues to apply. Editing
an API key keeps existing item identities; changing the server URL requires a new
connection, to prevent silently substituting another library under existing approvals.

## Connectivity and credentials

ZTube's Worker and the children's devices must both reach Jellyfin over HTTPS.
The Worker reads metadata and artwork; the browser downloads video directly.
An interactive login page or redirect in front of the API is not supported by the
current connection form. The video element uses ordinary cross-origin media
playback without custom authentication headers.

The API key is encrypted at rest and never returned by the settings API. Metadata
requests send it in a header only to the saved Jellyfin origin. For playback,
ZTube first probes the original MP4 anonymously with a tiny Range request. If the
server returns an MP4, the browser URL contains no credential. On HTTP 401/403,
ZTube includes the configured key as `ApiKey` in the direct URL, when upstream authentication is required. That key is visible to the browser and can grant broader
Jellyfin access; creating another server API key does not necessarily reduce its
permissions. Redirects and unexpected responses are rejected during the probe.

The MP4 probe does not apply to MKV/HLS. Current HLS URLs always include the
configured `ApiKey`, including when audio is copied. Both native HLS and hls.js
receive that URL. See [security boundaries](../SECURITY.md#playback-boundaries).

## Playback and limits

- Original direct playback uses MP4, with H.264 or HEVC video and AAC or MP3 audio (or no audio).
  HEVC depends on the actual iPad/browser and encoding profile. H.264/AAC remains
  the most portable combination. Video is never re-encoded.
- Existing ZTube duration rules apply: episodes of three minutes or less, unknown
  duration, or over 24 hours are excluded.
- MKV/Matroska (including Jellyfin's `mkv,webm` label) can be remuxed to fMP4 HLS
  when its video is H.264/HEVC and at least one audio track is AAC, MP3, AC3 or
  EAC3. A browser-compatible audio track is selected automatically. If neither playback engine supports the original audio, Jellyfin converts it
  to stereo AAC at 192 kbps. Video remains a stream copy. Sources outside the
  listed codecs are still excluded.
- There is no external subtitle loading, subtitle burn-in, manual audio-track
  selection, Jellyfin watch-state reporting, or password-based login.
- After the Child confirms a one-time unlock, ZTube authorizes native playback and
  asks Jellyfin for `PlaybackInfo` with `EnableDirectPlay: true`,
  `EnableDirectStream: false`, and `EnableTranscoding: false`.
- MKV uses a second PlaybackInfo negotiation with a DeviceProfile. Audio
  conversion is enabled only when no original-audio playback path works.
  **Connections → Edit connection → Playback user** can select an enabled Jellyfin
  user with library and Remux permission, plus audio transcoding permission
  when AAC conversion is needed. Automatic selection prefers non-admins
  and skips users unable to access the episode. It never changes user permissions.
- HLS checks native and MSE codec support separately, then uses native playback
  or lazy-loaded hls.js for the complete audio/video pair. Chrome can use native
  HLS when its MSE interface cannot decode the original audio. All manifests, initialization
  data and media segments go directly from Jellyfin to the browser. Jellyfin must
  permit cross-origin requests from ZTube. Every issued HLS URL forces
  `VideoCodec=copy` and disables subtitles. Audio uses `AudioCodec=copy` when
  supported, otherwise `AudioCodec=aac` with a stereo limit. All audio encoding
  runs on Jellyfin; the Worker handles metadata and authorization only.
- For original MP4, the HTML video element receives a Jellyfin URL of the form
  `Videos/{itemId}/stream.mp4?Static=true&MediaSourceId=...`, optionally with
  `ApiKey` when upstream authentication is required. Video bytes do not pass
  through the Worker; the previous ZTube `/stream` proxy endpoint is removed.
- Issuing a URL verifies Child ownership, approval, permanent unlock, time pool,
  Viewing Window, Required Break, Viewing Pause and Active Playback lease.
  Heartbeats still account for active playback, renew the lease, and stop/remove
  the player when blocked. This applies to playback inside ZTube.
- A copied direct URL can keep working outside ZTube's claim and time limits.
  This is a limitation of direct media delivery.
  Jellyfin or its reverse proxy controls whether those URLs need authentication;
  adding a key to a URL cannot prevent anonymous access if the server allows it.

## Synchronization

The existing 30-minute scheduled job checks imports and updates those whose last
successful sync is at least six hours old. **Sync** bypasses that wait.
Titles, episode order, durations and supported membership are replaced atomically;
failed fetches preserve the previous complete snapshot. Successful syncs preserve
Child approvals, Pool Bindings, Episode Unlocks, viewing progress and usage. Newly added
episodes within the selected series/season become available under those approvals.
An import supports up to 5,000 episodes; split larger series into seasons.

## Operational checks

For newly supported files in an existing import, press **Sync**. Existing
approvals and permanent unlocks remain intact. Preview real files on the target
iPad; codec support depends on the device and browser, not just the filename.

Remux sessions are released on exit, playback completion, errors and time-limit
stops. The scheduled job retries abandoned sessions on its next 30-minute pass.
Ordinary heartbeats make no Jellyfin requests. Browser crashes can delay cleanup;
Jellyfin's own idle cleanup also applies.

Verify audio, forward/backward seeking, long playback and device takeover on your
actual server. Automated fixtures cover application behavior and HLS decoding,
but cannot establish compatibility with every Jellyfin version or Apple device.
