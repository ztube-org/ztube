# Jellyfin MKV playback with video copy

Jellyfin may remux MKV/Matroska into fMP4 HLS while preserving the original video.
This extends [ADR 0011](0011-jellyfin-direct-mp4.md) without changing Playlist
identities, approvals, Episode Unlocks or Time Pools. The Worker negotiates
metadata and issues a URL; browsers fetch manifests and segments directly from
Jellyfin. It does not run FFmpeg or proxy video.

## Codec negotiation

H.264 and device-compatible HEVC are supported. AAC, MP3, AC3 and EAC3 source
audio are eligible. Prefer complete original-codec paths. When none is playable,
Jellyfin may convert audio to stereo AAC at 192 kbps if the same playback engine
supports the original video and AAC. Video is always copied, never re-encoded.

Native and MSE codec capabilities remain separate. Prefer native Apple HLS;
elsewhere prefer hls.js when its MSE path supports the complete codec pair, with
native HLS as fallback. HLS uses anonymous CORS set before assigning its source.
That setting does not remove an API key in the URL.

Only the saved origin and requested item's HLS master path are accepted. Rebuild
URL parameters to force `VideoCodec=copy`, disable subtitles, and use either
`AudioCodec=copy` or AAC with `AllowAudioStreamCopy=false` and a two-channel limit.
Discard upstream encoder, resize and subtitle options. There is no manual audio
track selection, subtitle conversion or video transcoding.

## Permissions and lifecycle

Negotiation needs a Jellyfin user. Connections may select one; otherwise try up
to ten enabled users, preferring non-admins and skipping users without access to
the episode. Jellyfin permissions govern remux and audio conversion. ZTube does
not modify those permissions or report Jellyfin watch state.

HLS URLs currently include the configured API key. Unlike original MP4, this
path does not first probe anonymous playback. The credential exposure and copied
link limitations in [SECURITY.md](../../SECURITY.md) apply.

Every resolution has a random device ID and cleanup record bound to the Playback
Authorization. Cleanup accepts only that owned record, including after lease
expiry, so late cleanup cannot stop another generation or Child. Release on end,
error, time blocking, navigation and late startup. A failed final authorization
recheck cleans up before responding. The 30-minute cron retries abandoned,
expired or disabled sessions in bounded batches. Heartbeats make no Jellyfin call.
A tab/process crash can delay cleanup until that pass or Jellyfin's idle cleanup.

Real device testing is necessary for Safari codecs, audio and seeking. Local
fixtures verify the application lifecycle and playable test media only.
