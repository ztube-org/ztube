# Retain Admin Viewing Events for 30 days

The Admin now explicitly needs to see when a Child watched which video and for how long, including completed playback. Retain a separate Viewing Event for each newly authorized playback session, with video and channel title snapshots, first and last counted playback timestamps, usage bucket, and charged watch seconds; only Admins may query this detail. This supersedes the no-history portions of ADRs 0002, 0005, and 0007 while preserving aggregate-only Daily Usage Summaries and bounded Continue Watching state.

Use the same atomic, capped server-side settlement as the daily ledger so duplicates, takeovers, and lease expiry cannot inflate event durations. Records with no counted playback are hidden; timestamps indicate counted intervals rather than every pause/resume, and gaps do not count. Sessions already active when recording is deployed and older aggregate data are not backfilled.

Retain detail for 30 days from session authorization, filter expired detail from every query, and delete it during the existing 30-minute scheduled cleanup. This bounds detailed history while preserving lifetime daily totals. Deleting a Child cascades to its events. Playback Authorization still clears its temporary video ID on completion; the separate event retains its snapshot until expiry.
