# Daily credits buy permanent episode unlocks

The owner replaced day-scoped episode access with daily, non-accumulating Unlock Credits. Confirming one new episode spends a credit and permanently unlocks that video for the Child; replaying it on any later day costs Watch Time but no credit. This supersedes prior daily claim expiry: resuming yesterday’s ending must not waste today’s choice. Approval revocation, time pools and viewing controls still govern every playback.

Keep daily credit debits separate from permanent unlocks. A database trigger commits both atomically, and duplicate or cross-device requests for an already unlocked episode cannot consume more credits. Backfill from retained claims and cartoon viewing records; daily debit pruning must never prune unlocks. Records already removed by historical retention cannot be reconstructed. The viewer uses Series and Unlocked views instead of stacked continue/claimed shelves.


On 2026-09-17 the owner requested temporary Admin grants to correct accidental
unlocks. Each grant adds one Unlock Credit for the Child's current Viewing Day;
it does not change recurring daily limits, reverse prior permanent unlocks, or
grant Watch Time. Grants and claims use the same Child-local date. An Admin-only
endpoint records the granting Admin and a client operation ID; retries of that
ID cannot add credits twice. A stale day is rejected and requires a new explicit
action. Atomic claim admission counts the recurring limit plus today's grants.
Daily pruning removes expired grants alongside claims, never permanent unlocks.
