# Self-hosting operations

Start with the [README deployment walkthrough](../README.md#self-host-on-cloudflare).
This guide covers verification, iPad setup and maintaining an existing instance.

## Configuration reference

| Setting | Where | Purpose |
| --- | --- | --- |
| `AUTH_MODE=access` | `cloudflare.config.ts` bindings | Production authentication |
| `ACCESS_ISSUER` | `cloudflare.instance.json` → `accessIssuer` | `https://<team>.cloudflareaccess.com` |
| `ACCESS_AUD` | `cloudflare.instance.json` → `accessAud` | Access application's Audience tag |
| `ADMIN_EMAILS` | Worker secret | Comma-separated Admin emails; also allow them in Access |
| `YOUTUBE_API_KEY` | Worker secret | Required for YouTube import and refresh |
| `PROVIDER_ENCRYPTION_KEY` | Worker secret | Base64-encoded random 32-byte key for WebDAV/Jellyfin credentials |
| `AUTH_MODE=local`, `LOCAL_DEV_USER_EMAIL` | Ignored `.dev.vars` only | Loopback development identity |

To update secrets, edit ignored `.secrets.production.json` and run
`npm run deploy -- --secrets-file .secrets.production.json`. Deployments without
that option retain existing secrets. The Access issuer and audience are identifiers,
not credentials. ZTube fails closed when Access
verification is missing or invalid; a client-supplied email header is insufficient.

Create Access protection before deploying the custom domain. Keep `workersDev`
and `previewUrls` disabled, and protect any additional hostname before adding it.
The Cloudflare references are [Access applications][access], [JWT validation][jwt],
[D1 setup][d1] and [Worker custom domains][domains].

## Verification after setup or upgrades

- An unlisted email cannot pass Access; an allowed Child cannot call Admin APIs.
- Admin accounts see the dashboard and every signed-in account has a Child profile.
- Approved content plays; unapproved content does not.
- Watch Time increases only during active playback. Pausing, backgrounding and
  buffering do not add time. A second device takes over Active Playback.
- Viewing Pause, the Viewing Window and an exhausted Time Pool stop playback.
- Episode Unlocks survive the next Viewing Day; unused Unlock Credits do not.
- Test actual media on the target iPad, including seeking and audio.

Daily Usage Summaries remain for the profile's lifetime. Per-video Viewing Events
are retained for 30 days and exposed to Admins. See [privacy details](../SECURITY.md).

## Set up an iPad

1. Open the ZTube hostname in Safari and sign in as the Child.
2. Tap **Share → Add to Home Screen**, keeping **Open as Web App** enabled if offered.
3. Confirm sign-in and playback work from the Home Screen icon.

Playback stops when ZTube goes into the background, including when the iPad is
locked. Return to ZTube and tap **Try again** to check the remaining allowance
before continuing. Picture-in-picture is disabled where the browser supports it.
Playback also stops if a viewing-time check fails or takes more than five seconds;
restore the connection and try again. Test these transitions on the target iPad.

ZTube cannot block the YouTube website or app. If you need device-level controls,
configure Screen Time with a passcode the Child does not know:

1. Remove the YouTube app and restrict app installation as appropriate.
2. Under **Content & Privacy Restrictions → Web Content**, choose **Limit Adult
   Websites**, then add `youtube.com`, `www.youtube.com`, `m.youtube.com` and
   `youtu.be` to **Never Allow**.
3. Add your ZTube hostname to **Always Allow** if available.
4. Do not block the embedded player's required hosts: `youtube-nocookie.com`,
   `googlevideo.com`, `ytimg.com` and `gstatic.com`.
5. Verify both that ZTube playback works and that direct YouTube access is blocked.

Menu names and embedded-player behavior vary by iPadOS version. Adjust based on
actual device testing. Guided Access can help for supervised sessions; it does
not replace Access sign-in or device restrictions.

## Copy Approved Content between Children

The Child profile's **Copy Approved Content** action copies approvals, Cartoon
Pool membership, default pool choices and tags. It adds missing items and updates
matching items without removing other approvals.

The target Child keeps their own Time Pools, custom Pool Bindings, budgets and
unlock requirements. Source custom Pool Bindings and budgets are not copied;
content without a target binding uses the target's default pools. A source custom
pool's Episode Unlock requirement therefore does not automatically follow copied
content. Review the target's pool assignments and unlock requirements after
copying. Cartoon Pool membership still requires an Episode Claim. Existing
Episode Unlocks, usage and viewing records remain private to each Child.

## Backup

Export D1 from the Cloudflare dashboard before upgrades and save the SQL file in
ignored `backups/`. The cf beta currently has no equivalent to the old SQL export
command. You can also inspect D1 Time Travel bookmarks with
`npx cf d1 time-travel get-bookmark <DATABASE_ID>`; a bookmark is not an independent
backup.

Keep an encrypted copy outside this checkout. Exports contain emails, viewing
records and encrypted Provider credentials. Store `PROVIDER_ENCRYPTION_KEY`
separately in a password manager; a database backup alone cannot restore those
credentials. Preserve your Worker configuration and other secrets as well.

## Upgrade

Instance values live in ignored `cloudflare.instance.json`; keep a private backup.
Updates to tracked `cloudflare.config.ts` do not replace those values. Review any
new fields in `cloudflare.instance.example.json` when upgrading.

```sh
git pull --ff-only
npm ci
npx playwright install chromium
npm run cf:typegen
npm run db:migrate:remote
npm run deploy
```

Apply every pending migration. Normal migrations and deployment preserve data.
`npx cf workers versions list` lists Worker versions. Roll back a deployment
from the Worker dashboard; this changes code only, not D1 schema or data.
Check schema compatibility before
rolling back. Restore backups to a separate database first when testing recovery.

## Deliberate database reset

`npm run db:clear -- --local` deletes local application data. The `--remote`
variant deletes the configured remote application's data, including profiles,
approvals, unlocks, usage and saved connections. Both require a typed confirmation
and preserve schema/migration history. **Neither belongs in deployment or CI.**
Back up first and confirm the selected account/database before a remote reset.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `503` about Access configuration | Set the correct `ACCESS_ISSUER` and `ACCESS_AUD`, then rebuild and redeploy. |
| `401` after signing in | Check Access application AUD, team URL, token expiry and hostname; sign out and in again. |
| Local authentication returns `403` | Open the dev server through `localhost` or a loopback IP, not a LAN/public hostname. |
| Admin lands in the viewer | Signed-in email must be in `ADMIN_EMAILS`; update that Worker secret. |
| YouTube import fails | Verify API enablement, key restrictions and quota; browser-referrer restrictions are unsuitable. |
| Video is missing | Check duration, embeddability, approval and supported codecs. |
| Provider credentials cannot be decrypted | Restore the original encryption key, or deliberately recreate the connection with new credentials. |
| Database table/column error | Apply all migrations to the database in this checkout's config. |
| Type generation check fails | Run `npm run cf:typegen` after configuration or cf changes. |
| Chromium cannot launch | Run Playwright's browser installation and, on Linux, install its required system libraries. |
| Jellyfin HLS fails but MP4 works | Check browser-to-Jellyfin HTTPS/CORS and Jellyfin playback/remux permissions; see [Jellyfin setup](jellyfin.md). |

[access]: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
[jwt]: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
[d1]: https://developers.cloudflare.com/d1/get-started/
[domains]: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
