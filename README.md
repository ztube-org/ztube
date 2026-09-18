# ZTube

A self-hosted video library for families. Admins choose what each Child can watch
from YouTube, WebDAV or Jellyfin, and set daily viewing budgets and required breaks.
Built with Vue, Hono, Cloudflare Workers and D1. Licensed under [MIT](LICENSE).

- Approve channels, playlists or individual videos separately for each Child.
- Organize viewing budgets into Time Pools, with weekday/weekend allowances.
- Set Viewing Windows, Required Breaks, Viewing Pause and extra minutes for today.
- Give daily Unlock Credits for new episodes; an Episode Unlock is permanent while
  the content remains approved. Replays still consume Watch Time.
- Browse Favorites, Recommendations and Continue Watching on compact iPad layouts.
- Review aggregate daily usage and 30 days of per-video Viewing Events.

**ZTube controls playback inside its own player.** It is not a device-level filter
or DRM: direct media links may work outside its controls. Read the
[security boundaries](SECURITY.md) before sharing an instance with Children.

## Self-host on Cloudflare

This is the supported deployment path; a separate application server or Docker
host is not required. Jellyfin/WebDAV servers, if used, are hosted separately.

### 1. Prepare your accounts and tools

You need:

- **Node.js 24 or newer**, npm and Git. Node 24 LTS is the recommended version.
- A **Cloudflare account**, a domain using Cloudflare DNS, and a Zero Trust team.
- An email address for each Admin and Child; Cloudflare Access handles sign-in.
- For YouTube: a Google Cloud project with **YouTube Data API v3** enabled and an
  API key restricted to that API. Do not restrict it by browser referrer; the
  Worker makes these requests. See [Google's setup guide][youtube].

Check Cloudflare/Google quotas and current pricing for your usage. YouTube is
optional if you use only WebDAV or Jellyfin.

```sh
git clone https://github.com/ztube-org/ztube.git
cd ztube
npm ci
npx playwright install chromium
npx wrangler login
npx wrangler d1 create ztube-db
```

On Linux, Playwright may also request system packages; follow its output or run
`npx playwright install-deps chromium`. Browser installation is needed because
the deploy command includes UI verification. Use a different database name if
`ztube-db` already exists in your account.

### 2. Configure sign-in before deploying

In **Cloudflare Zero Trust → Access → Applications**, add a **Self-hosted**
application for your chosen hostname, for example `videos.example.com`.

1. Protect the **entire hostname**, not just a path.
2. Add an **Allow** policy listing every permitted Admin and Child email.
3. Choose an identity provider; **One-time PIN** supports email sign-in.
4. Copy the application's **Application Audience (AUD) tag** and your team's
   URL, for example `https://your-team.cloudflareaccess.com`.

An Admin email must be included in the Access policy as well as `ADMIN_EMAILS`.
Do not add a Bypass policy or an unprotected alternate route. ZTube also verifies
Access JWT signatures, issuer, audience and expiry on every API request.

### 3. Edit the deployment configuration

The checked-in [`wrangler.jsonc`](wrangler.jsonc) contains **examples only**.
Replace these fields with your own values:

| Field | Value to use |
| --- | --- |
| `name` | Your Worker name, e.g. `ztube` |
| `routes[0].pattern` | The same hostname protected by Access |
| `d1_databases[0].database_name` | The name used in `d1 create` |
| `d1_databases[0].database_id` | The UUID returned by `d1 create`; replace the all-zero placeholder |
| `vars.ACCESS_ISSUER` | Your Zero Trust team URL, including `https://` |
| `vars.ACCESS_AUD` | Your Access application's AUD tag |

Keep `AUTH_MODE` set to `access`, and keep `workers_dev` and `preview_urls`
disabled. If you have multiple Cloudflare accounts, select the intended one at
login or add its `account_id`. Do not put API keys or passwords in this file.

```sh
npm run cf:typegen
npm run db:migrate:remote
npm run deploy
```

Apply **all** migrations before deploying. `npm run deploy` runs the server and
browser tests, lint, type checks and production build before uploading the Worker.
The first deployment creates the Worker and its custom domain. Wait for the domain
certificate to become active if Cloudflare reports it as pending.

### 4. Set your Worker secrets

Set the comma-separated list of Admin emails, then the YouTube key if you use it.
Wrangler prompts for each value:

```sh
npx wrangler secret put ADMIN_EMAILS
npx wrangler secret put YOUTUBE_API_KEY
```

For example, `ADMIN_EMAILS` can be `parent1@example.com,parent2@example.com`.
Email matching is case-insensitive. Secret updates create a deployed Worker
version; you do not need to paste secrets into source files or rebuild the UI.

For **WebDAV or Jellyfin**, also generate a random encryption key:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
npx wrangler secret put PROVIDER_ENCRYPTION_KEY
```

Paste the generated value at the prompt and save it in a password manager.
It encrypts Provider credentials in D1; **keep it with your backups**. Replacing
it makes existing connections unreadable. YouTube-only instances do not need it.

### 5. Sign in and add content

1. Open your hostname in a private browser window. Verify that Access denies an
   email outside your Allow policy.
2. Sign in with an Admin email. You should see the Admin dashboard. Every account,
   including an Admin, automatically receives its own Child profile.
3. Sign in once with each Child email so their profiles appear in the dashboard.
4. Set each Child's time zone, Time Pools, Viewing Window and Required Break.
5. Add approved YouTube URLs, or connect a [WebDAV Provider](docs/openlist.md) or
   [Jellyfin library](docs/jellyfin.md), then share the Playlists with that Child.
6. Play an approved video as the Child. Check that Watch Time increases while
   playing, stops while paused, and Admin Viewing Pause stops playback.

Videos must be longer than three minutes. Each Child starts with General videos,
Cartoons and Learning pools; their settings are independent. Cartoon Pool episodes
require confirmation before spending an Unlock Credit. Unused credits and
Temporary Extensions expire at midnight in the Child's time zone; permanent
Episode Unlocks do not.

For iPad setup, backups, upgrades and troubleshooting, continue with the
[self-hosting operations guide](docs/self-hosting.md).

## Run locally

No Cloudflare account is needed for local D1 development. Use the example
`wrangler.jsonc` unchanged and create a local secrets file:

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Open `http://localhost:5173`. The example signs in as a local Admin. Change
`LOCAL_DEV_USER_EMAIL` in `.dev.vars` to an email outside `ADMIN_EMAILS` to test a
Child account, and restart the dev server. Add a YouTube API key to use YouTube,
and a separate local encryption key for Provider connections. These services
still require network access; test fixtures do not.

Local authentication is restricted to loopback hostnames. Never deploy
`AUTH_MODE=local`, expose the development server publicly, or commit `.dev.vars`.

## Development and documentation

```sh
npx playwright install chromium  # once per installed Playwright version
npm run check                   # tests, lint, generated types, type checks, UI build/tests
```

Tests use isolated databases and fixtures. Real iPad Safari verification is still
needed for hardware codecs, native fullscreen, the onscreen keyboard and Home
Screen mode.

- [Contributing and project structure](CONTRIBUTING.md)
- [Security, privacy and reporting vulnerabilities](SECURITY.md)
- [Self-hosting operations](docs/self-hosting.md)
- [WebDAV / OpenList setup](docs/openlist.md)
- [Jellyfin setup and supported formats](docs/jellyfin.md)
- [Domain glossary](CONTEXT.md) and [architecture decisions](docs/adr/)
- [Issues](https://github.com/ztube-org/ztube/issues)

[youtube]: https://developers.google.com/youtube/v3/getting-started
