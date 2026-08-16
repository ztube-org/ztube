# Time Control Design

## Goal

Limit how long each child can watch ordinary approved content while allowing a parent to exempt selected channels, playlists, or videos. Enforcement must work across devices and must not be bypassable by changing the `/watch?v=` URL.

ZTube enforces these rules only inside ZTube. Blocking youtube.com or other applications is the responsibility of device- or network-level parental controls.

## Policy

Each child has a fixed IANA time zone selected by the parent. It initially defaults to the parent's browser time zone. A Viewing Day is the local calendar day in that zone; it changes once at local midnight, including across daylight-saving transitions.

Recurring settings are:

- weekday Daily Allowance: 60 minutes by default;
- weekend Daily Allowance: 120 minutes by default;
- allowance-exempt Safety Cap: 180 minutes by default.

Saturday and Sunday are weekends. Each value is adjustable in 15-minute increments from 0 through 1,440 minutes. Zero disables that class of content for the day. The Safety Cap is always finite.

Parents may mark an approved channel, playlist, or individual video as allowance-exempt. Rules belong to a child, so the same content may have different rules for different children. When multiple rules match a video, the most specific rule wins: video, then playlist, then channel. A restricted rule wins among matches at the same specificity. The result is independent of the page or link used to enter the player.

A parent may create a video-specific override directly from a channel or playlist without adding a duplicate standalone video card.

## Counting Time

The server records wall-clock seconds while the YouTube player is actively playing:

- playback speed does not affect the count;
- paused, buffering, ended, or ordinary background-tab time does not count;
- a hidden page automatically pauses playback;
- visible picture-in-picture playback counts;
- advertisements count because the IFrame API cannot identify them reliably;
- seeking does not add the skipped content duration.

Restricted and allowance-exempt playback accumulate in separate daily buckets. The latter does not consume the ordinary Daily Allowance.

Only one Active Playback is allowed per child. Starting another player transfers the active lease; the previous player is instructed to stop and loses authorization even if that instruction is delayed.

## Enforcement

The server, not the browser, is authoritative for approval, rule resolution, daily usage, and remaining time.

Before creating the YouTube player, the client requests Playback Authorization for the requested video. The server must establish that the video is an approved standalone video or is a member of an approved channel or playlist. An arbitrary video ID is rejected. Authorization resolves all matching Content Rules and returns a short-lived playback session for the applicable usage bucket.

The player reports state and renews its session periodically. A suggested starting point is a 15-second heartbeat and a 60-second lease. The server derives chargeable elapsed time from acknowledged active intervals and never trusts a client-supplied usage total. If connectivity is lost, playback may continue for at most the 60-second grace period; it then pauses until the server reauthorizes it.

The server must serialize session activation and usage updates per child so concurrent requests cannot create two active sessions or overspend the final seconds of an allowance. Heartbeats are idempotent.

When remaining time reaches zero, the server ends authorization and the player pauses immediately. The child is warned at 10 minutes, 5 minutes, and 1 minute remaining. The exhausted class of content remains visible but locked; content with remaining time in the other bucket remains playable.

The child UI shows remaining time down to the second. The parent UI shows whole minutes.

## Parent Overrides

A parent may add 15, 30, or 60 minutes to either usage bucket for the current Viewing Day. A parent may also unlock the ordinary limit for today: ordinary playback continues to be measured but is not blocked until local midnight. This does not alter or unlock the allowance-exempt Safety Cap.

Changing a recurring allowance takes effect immediately. If usage already meets the new value, current playback stops; the parent UI warns about that effect before saving. Temporary extensions and today's unlock state expire at the next local midnight.

## Parent Experience

The child management page adds:

- fixed time zone selection;
- weekday, weekend, and allowance-exempt limits;
- today's restricted and allowance-exempt used/remaining values;
- temporary extension and ordinary-limit unlock controls;
- a restricted/allowance-exempt control on channels, playlists, and videos;
- video-specific overrides accessible inside channel and playlist content.

Child-facing allowance-exempt content is labelled “不计入普通额度” and shows its remaining safety time. It is not called unlimited or automatically described as learning content.

The first release sends no email notifications and shows no historical chart.

## Data Model

Implementation should add concepts equivalent to:

- **Child time settings**: fixed time zone and the three recurring allowance values.
- **Content rules**: child, target kind, external target ID, and restricted/exempt mode. The model must support video overrides that are not standalone allowlist entries.
- **Daily usage summaries**: child, local date, seconds used in each bucket, temporary additions, and today's ordinary-limit unlock flag. There is one row per child and Viewing Day.
- **Playback sessions**: opaque session ID, child, video, resolved bucket, state, last acknowledged activity, and lease expiry.

Daily summaries are retained for the lifetime of the child without per-video history. Deleting a child cascades to settings, rules, summaries, and sessions. Recreating the same email creates a new child and restores nothing.

Video membership and metadata must be sufficient for the server to resolve all applicable channel, playlist, and video rules without trusting an entry route supplied by the client. Cache refreshes must not transiently authorize arbitrary content.

## Initial Rollout

The current database contains disposable data. Deployment of this feature may clear all database data, including parents, children, allowlists, and caches; all accounts and approved content will be recreated. No compatibility migration for existing content rules is required.

Database deletion is an implementation-time rollout action, not part of creating this design document.

## Acceptance Criteria

- Changing `/watch?v=` to an unapproved video never creates a player.
- A video receives the same policy regardless of entry route.
- Video rules override playlist rules, playlist rules override channel rules, and restricted wins at equal specificity.
- Only active foreground or picture-in-picture playback consumes seconds; ads consume seconds.
- Playback at 2x consumes the same wall-clock seconds as playback at 1x.
- A second device takes over the child's session and the first can no longer renew playback.
- A disconnected player stops within 60 seconds.
- Lowering a limit below current usage stops the affected playback immediately.
- Ordinary and allowance-exempt usage stop independently at their respective limits.
- Midnight in the child's fixed zone selects the new day's allowance exactly once, including DST transitions.
- Deleting a child removes all settings and aggregate usage; reusing the email restores nothing.
