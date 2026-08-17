# ZTube

ZTube gives the Admin control over which YouTube content a child may watch and how long the child may watch it.

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

**Restricted Watch Time**:
Wall-clock time during which restricted content is actively playing for a child, including advertisements. Paused, buffering, or backgrounded playback does not count, and playback speed does not change the amount counted.
_Avoid_: Screen time, video duration

**Daily Allowance**:
The amount of Restricted Watch Time available to a child for one local calendar day, with independently configurable weekday and weekend values.
_Avoid_: Time limit, quota

**Allowance-Exempt Content**:
Approved Content that the Admin marks as not consuming the child's Daily Allowance. Channels, playlists, and individual videos can each be marked independently for each child.
_Avoid_: Learning content, unlimited content, whitelist

**Safety Cap**:
A separate daily maximum that applies to Allowance-Exempt Content despite it not consuming the Daily Allowance.
_Avoid_: Unlimited time, learning limit

**Content Rule**:
A per-child designation that makes Approved Content restricted or allowance-exempt. When multiple rules match a video, the most specific rule applies—individual video before playlist before channel—and a restricted rule wins among equally specific matches.
_Avoid_: Category, entry route

**Temporary Extension**:
Additional Restricted Watch Time granted by the Admin for the current local calendar day without changing the child's recurring Daily Allowance.
_Avoid_: Permanent limit change, bonus

**Active Playback**:
The single player currently authorized to play content for a child. Starting playback on another device transfers this status and stops the previous player.
_Avoid_: Login session, device allowance

**Viewing Day**:
A calendar day in the fixed time zone selected for the child by the Admin. Allowances reset at local midnight, and playback continuing across midnight begins consuming the new day's allowance.
_Avoid_: Rolling 24 hours, device day, server day

**Daily Usage Summary**:
A child's aggregate record of Restricted Watch Time and allowance-exempt watch time for one Viewing Day. It is retained for the lifetime of the Child and deleted with the Child; it does not identify watched videos.
_Avoid_: Watch history, activity log

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
Confirmation that a requested video belongs to the child's Approved Content and is currently permitted by the applicable viewing allowance.
_Avoid_: URL validation, player check
