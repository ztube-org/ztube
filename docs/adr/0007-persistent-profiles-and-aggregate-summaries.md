# ADR 0007: Keep persistent Child profiles and bounded aggregate summaries

## Status

Accepted — supersedes the account-deletion and today-only reporting acceptance criteria in GitHub Issue #9.

## Context

Every authenticated identity receives a Child profile, with Admin capability layered onto configured identities. Manual profile creation or deletion would make identity ownership ambiguous and could orphan configuration. Admins also need enough trend information to tune recurring allowances, while ZTube must not retain per-video viewing history.

## Decision

- Child profiles are created on first authenticated sign-in and persist with that identity. Admin APIs do not manually create or delete them.
- Admins may view 7-day and 30-day Daily Usage Summaries.
- Summaries contain aggregate restricted and exempt seconds only. They do not contain video IDs, titles, channels, playlists, or playback events.
- Active Playback may temporarily retain a video ID for resume-state maintenance. Normal completion clears it immediately; abandoned sessions are cleared by the scheduled cleanup no later than 30 minutes after lease expiration.

## Consequences

Account lifecycle follows the configured identity provider instead of a second ZTube ownership model. Admins can recognize usage trends without gaining viewing history. Removing an identity's stored profile, when operationally required, remains an explicit data-maintenance action rather than an everyday Admin control.
