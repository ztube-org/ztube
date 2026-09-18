# Security and privacy

## Report a vulnerability

Use the repository's [private vulnerability reporting form](https://github.com/ztube-org/ztube/security/advisories/new)
if available. If it is unavailable, open an issue asking maintainers for a private
contact method **without including exploit details or secrets**. Never post API
keys, Access tokens, family records or signed media URLs in public issues.
Only the current mainline is maintained; there is no separate security backport branch.

## Authentication and deployment

Protect the entire hostname with Cloudflare Access. Production API requests
verify `Cf-Access-Jwt-Assertion` using your team's signing keys and check its
issuer, application audience, expiration and signed email. Admin capability comes
from `ADMIN_EMAILS`. An unsigned email header does not establish identity.
Local identity bypass is restricted to loopback hosts and is for development only.
Keep Worker preview URLs and `workers.dev` disabled.

All Admins manage all Children and Provider connections. This is a private family
application, not an isolated multi-tenant hosting service. Configure Providers only
for upstream services you trust. HTTPS hostname checks do not establish DNS-level
network isolation or prove that a destination resolves to a public IP.

## Playback boundaries

ZTube authorizes approved content and meters its player through renewable playback
leases and heartbeats. It does not provide DRM or enforce controls in other
applications. A modified client or copied media URL can bypass the player; use
device controls when that boundary matters.

WebDAV credentials remain on the Worker. Its browser playback URLs must be readable
without those credentials; signed media URLs are bearer links that can remain
usable after ZTube authorization expires.

Jellyfin has three distinct behaviors:

| Media path | Credential in the URL returned to the browser |
| --- | --- |
| Original MP4, successful anonymous probe | None |
| Original MP4, anonymous probe returns 401/403 | Configured Jellyfin `ApiKey` |
| MKV via HLS/remux | Configured Jellyfin `ApiKey` |

The key in authenticated playback URLs may authorize more than that episode,
including other Jellyfin APIs. Creating another API key does not necessarily
restrict its permissions. An anonymously readable MP4 still bypasses ZTube when
copied. HLS `crossOrigin="anonymous"` does not remove query-string credentials.
Review your upstream authorization model before enabling Jellyfin for users you
do not trust with those credentials. See [Jellyfin setup](docs/jellyfin.md).

## Stored data

- Account email and profile, approvals, Favorites, Recommendations and permanent
  Episode Unlocks persist with the Child profile.
- Daily Usage Summaries retain aggregate Watch Time for the profile's lifetime.
- Admin-visible Viewing Events identify videos and charged Time Pools for 30 days.
- Continue Watching retains up to ten unfinished videos after at least 30 seconds
  of playback; completion removes progress. This is not completed watch history.
- WebDAV passwords, custom authentication headers and Jellyfin API keys are
  AES-GCM encrypted in D1. The encryption key is a separate Worker secret.
- Scheduled cleanup and request-time filtering implement retention; backups may
  retain older records until you delete them under your own backup policy.

Profile deletion is not currently exposed as a self-service UI/API. The deliberate
application reset removes all profiles and application data. Operators needing
selective deletion must manage it with appropriate database backups and care.
Provider services, YouTube and Cloudflare have their own logs and privacy policies.

## Keeping a public checkout clean

Keep `.dev.vars*`, `.env*`, database exports and private operations notes ignored.
Use only synthetic records and `example.com` addresses in tests and documentation.
Scan the full Git history before publishing a fork, not just the current files.
Removing a credential from a branch or rewriting history does not revoke it or
remove copies in forks, caches or existing clones; rotate exposed live credentials.
