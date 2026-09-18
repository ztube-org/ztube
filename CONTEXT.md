# ZTube

ZTube gives the Admin control over which videos a child may watch and how long the child may watch them.

## Language

**Admin**:
A capability granted to accounts identified by configured email addresses. Admins collectively manage every Child while retaining their own Child profile for viewing and testing.
_Avoid_: Separate parent account, Superadmin

**Child**:
A viewer profile automatically created for every authenticated account, including an Admin. A Child has independently managed Approved Content and viewing allowances.
_Avoid_: Manually created account, device

**Approved Content**:
A channel, playlist, or individual video that the Admin has explicitly made available to a child. Videos of three minutes or less are excluded, including Shorts found inside an approved channel or playlist.
_Avoid_: Allowed URL, safe content

**Provider**:
An Admin-managed connection to an external media library from which videos can be selected for Playlists. Adding a Provider does not make its files Approved Content for any Child.
_Avoid_: Playlist, Child account, approval

**Playlist**:
An ordered collection of videos imported from YouTube or assembled by the Admin from connected Providers. The same Playlist can be approved for multiple Children, with independently assigned Pool Bindings and tags.
_Avoid_: Storage directory, Provider, Child-specific copy

**Watch Time**:
Wall-clock time during which Approved Content is actively playing for a Child, including advertisements and replays. Paused, buffering, or backgrounded playback does not count, and playback speed does not change the amount counted.
_Avoid_: Screen time, video duration

**Time Pool**:
A named daily Watch Time budget belonging to one Child, with independently configurable weekday and weekend allowances. Content bound to the same pool shares minutes; different pools and different Children do not, and a pool may additionally require an Episode Unlock before first playback.
_Avoid_: Usage bucket, Content Rule, unlimited content

**Daily Allowance**:
The amount of Watch Time available in one Time Pool for one Viewing Day.
_Avoid_: Global allowance, rolling quota

**Pool Binding**:
An Admin's assignment of Approved Content to a Child's Time Pool. An individual video takes priority over playlists, then channels; equally specific assignments to different pools block playback until the Admin explicitly assigns the video, while Cartoon Pool membership always uses the cartoon library's binding.
_Avoid_: Content Rule, entry route, tag

**Temporary Extension**:
Additional Watch Time granted to one Time Pool for the current Viewing Day without changing its recurring allowance or another pool's balance.
_Avoid_: Permanent limit change, shared bonus

**Active Playback**:
The single player currently authorized to play content for a child. Starting playback on another device transfers this status and stops the previous player.
_Avoid_: Login session, device allowance

**Viewing Day**:
A calendar day in the fixed time zone selected for the child by the Admin. Allowances reset at local midnight, and playback continuing across midnight begins consuming the new day's allowance.
_Avoid_: Rolling 24 hours, device day, server day

**Viewing Window**:
The recurring local-time interval during which a Child may receive Playback Authorization on every Viewing Day.
_Avoid_: Bedtime, device schedule

**Break Cycle**:
The active playback accumulated across all Time Pools, since the Child most recently completed a Required Break.
_Avoid_: Video duration, playback session

**Required Break**:
A configured period during which Playback Authorization is unavailable after a Break Cycle reaches its maximum.
_Avoid_: Paused video, exhausted allowance

**Viewing Pause**:
An Admin intervention that blocks all playback for the rest of the current Viewing Day unless the Admin resumes it.
_Avoid_: Permanent disable, player pause

**Daily Usage Summary**:
A Child's aggregate record of Watch Time used across Time Pools for one Viewing Day. It is retained for the lifetime of the Child and deleted with the Child; it does not identify watched videos.
_Avoid_: Watch history, activity log

**Viewing Event**:
An Admin-visible record of one playback session, identifying the video, first and last counted playback times, and watch time charged to its Time Pool. Viewing Events are retained for 30 days; pauses and buffering do not add watch time.
_Avoid_: Daily Usage Summary, video duration, heartbeat log

**Favorite**:
An Approved Content video that a Child has marked for quick access. Favorites are private to the Child and do not make unavailable content playable.
_Avoid_: Admin approval, playlist

**Continue Watching**:
The Child's ten most recently updated unfinished videos, retained only after 30 seconds of playback and removed when completed. It is navigation state rather than completed viewing history.
_Avoid_: Watch history, activity log

**Recommendation**:
An Approved Content video that an Admin highlights for one Child. An unseen Recommendation appears in New for You until that Child opens it; recommending it again makes it unseen again.
_Avoid_: Favorite, notification, additional approval

**Playback Authorization**:
Confirmation that a requested video belongs to the child's Approved Content and is currently permitted by the applicable viewing allowance and, for Cartoon Pool content, an Episode Unlock.
_Avoid_: URL validation, player check

**Approved Content Tag**:
A short Admin-defined label used to organize a Child's Approved Content without changing its availability or Pool Binding.
_Avoid_: Category, Pool Binding

**Cartoon Pool**:
The combined episodes an Admin makes available to one Child to unlock, including imported series and seasons. Its library uses a selected Time Pool and shares daily Unlock Credits with other unlock-required content, regardless of the entry route.
_Avoid_: Provider, daily playlist, Time Pool

**Episode Claim**:
A Child's explicitly confirmed use of one Unlock Credit to obtain an Episode Unlock. Repeating a claim for an already unlocked episode never spends another credit.
_Avoid_: Playback Authorization, temporary access, completed episode

**Unlock Credit**:
An allowance to unlock one new episode for a Child. The Admin sets a recurring daily allowance and may grant additional credits for the current Viewing Day to correct an accidental choice. Unused credits, including temporary grants, expire at local midnight and do not accumulate.
_Avoid_: Watch Time, rollover credit

**Episode Unlock**:
A Child's permanent unlock of one video, allowing future playback without another Unlock Credit while the video remains Approved Content. All playback and replays remain subject to Time Pools and viewing controls.
_Avoid_: Daily claim, unlimited viewing

**Imported Series**:
A Playlist whose episode membership, titles and season order follow a series or season in an external library. Importing alone does not grant access; the Admin selects which Children may unlock its episodes.
_Avoid_: Copied video files, Child-specific library
