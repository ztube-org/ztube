# Direct Jellyfin MP4 playback

Jellyfin video bytes go directly from the browser to Jellyfin. ZTube Workers
handle metadata, Playback Authorization, Episode Unlocks, Time Pools and heartbeat
accounting. Proxying media through the Worker adds CPU and traffic costs and is
not the supported delivery path.

For compatible original MP4, probe the static endpoint anonymously first. Return
a credential-free URL when it succeeds; on 401/403, add the configured Jellyfin
`ApiKey`. Metadata operations keep the key server-side, and connection settings
responses never expose it. Logs must not contain credential-bearing playback URLs.

This design cannot revoke a copied media URL or enforce ZTube viewing controls
outside its player. Authenticated URLs expose the configured API key to the
browser, potentially permitting other Jellyfin operations. Anonymous media access
is controlled by Jellyfin or its reverse proxy. These limitations must be clear
to anyone setting up an instance; see [SECURITY.md](../../SECURITY.md).

The original MP4-only restriction is superseded by [ADR 0013](0013-jellyfin-copy-only-remux.md),
which adds MKV-to-HLS remux and audio-only AAC fallback. The direct delivery
architecture remains the same.
