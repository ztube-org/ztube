# Self-host ZTube

This guide creates a private ZTube service on Cloudflare, protects it with
Cloudflare Access, and prepares an iPad for a Child. No ZTube account database
is managed by hand: each allowed email receives a Child profile on first
sign-in, and the emails in `ADMIN_EMAILS` also receive Admin access.

ZTube controls content and viewing time only while a video is played inside
ZTube. It does not disable youtube.com or the YouTube app. The iPad steps below
close those device-level escape routes.

## What you need

- A fork or clone of this repository
- A current Node.js LTS release, npm, and Git
- A Cloudflare account with a domain using Cloudflare DNS
- A Cloudflare Zero Trust organization
- A Google Cloud project with YouTube Data API v3 enabled
- One email address for each Admin and Child

Cloudflare and Google quotas or pricing can change. Check their current terms
before inviting users; this guide does not assume a particular free allowance.

## 1. Create a YouTube API key

1. In Google Cloud Console, create or select a project.
2. Open **APIs & Services → Library** and enable **YouTube Data API v3**.
3. Open **APIs & Services → Credentials** and create an API key.
4. Restrict the key to **YouTube Data API v3**. Do not use a browser-referrer
   restriction: the key is a Worker secret and requests originate at
   Cloudflare, not in the iPad browser.
5. Save the key somewhere private. Never add it to Git or `wrangler.jsonc`.

Google's official setup guide is [YouTube Data API — Getting Started][youtube].

## 2. Prepare Cloudflare

Clone your fork and install dependencies:

```bash
git clone https://github.com/YOUR-NAME/ztube.git
cd ztube
npm install
npx wrangler login
```

Create a D1 database. Use a unique name if the account already has a database
called `ztube-db`:

```bash
npx wrangler d1 create your-ztube-db
```

Copy the reusable configuration:

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

Edit `wrangler.jsonc` and replace all three example values:

- `name`: a unique Worker name in your Cloudflare account
- `routes[0].pattern`: the hostname you want, such as `ztube.example.com`
- `database_name` and `database_id`: the values returned by `d1 create`

The hostname's parent domain must already use Cloudflare DNS. Wrangler creates
the Worker custom domain when it deploys. The repository's main
`wrangler.jsonc` describes the maintainer's instance; do not deploy it unchanged
to another account. The example intentionally omits `account_id`, so Wrangler
uses the account selected during login.

Cloudflare references: [D1 setup][d1] and [Worker custom domains][domains].

## 3. Initialize the database

Apply every migration to the remote D1 database:

```bash
npm run db:migrate:remote
```

Normal deployments preserve data. Do not run `npm run db:clear`; that command
is an explicitly destructive recovery tool.

## 4. Deploy and configure secrets

Run the first deployment to create the Worker and custom domain:

```bash
npm run deploy
```

This runs linting, type checks, and a production build before `wrangler deploy`.
The first deployment does not expose family data: ZTube rejects requests that
do not carry an authenticated Cloudflare Access email.

Now set the API key and the comma-separated Admin email list. A Worker must
exist before `wrangler secret put` can create its secret-bearing version.
Wrangler prompts for values without putting them in shell history:

```bash
npx wrangler secret put YOUTUBE_API_KEY
npx wrangler secret put ADMIN_EMAILS
```

For example, the `ADMIN_EMAILS` value can be
`parent1@example.com,parent2@example.com`. Email matching is case-insensitive.
Every Admin still has a normal Child profile, which is useful for testing the
viewer experience. Re-run `npm run deploy` after both secrets are set so the
checked build, bindings, and current secrets are deployed together.

```bash
npm run deploy
```

Open the configured hostname. A `401` response is expected until Cloudflare
Access is configured.

## 5. Protect the hostname with Cloudflare Access

ZTube trusts `Cf-Access-Authenticated-User-Email`, which Cloudflare Access adds
after a successful sign-in. Do not create a second public Worker route that
bypasses Access.

1. In **Cloudflare Zero Trust → Access → Applications**, add a **Self-hosted**
   application.
2. Enter the exact ZTube hostname from `wrangler.jsonc`.
3. Add an **Allow** policy containing every Admin and Child email that may use
   this instance. An email in `ADMIN_EMAILS` must also be allowed here.
4. Choose an identity provider. **One-time PIN** is the smallest setup for a
   private family service; Google or another configured provider also works.
5. Pick a session duration appropriate for the iPad. A longer session is more
   convenient; a shorter one limits the impact of a shared or lost device.
6. Open ZTube in a private browser window and verify that an unlisted email is
   denied and an allowed email reaches the app.

See Cloudflare's [self-hosted application guide][access] and
[One-time PIN guide][otp].

## 6. Create the family profiles

1. Sign in with an Admin email. ZTube creates the profile and opens the Admin
   dashboard.
2. Sign in once on each Child's device. The Child then appears automatically in
   the Admin dashboard.
3. For each Child, set the display name, time zone, weekday/weekend Daily
   Allowance, Safety Cap, Viewing Window, and Required Break.
4. Add approved YouTube channel, playlist, or video URLs. Channels and playlists
   are cached and refreshed on the scheduled sync.
5. Mark content as **Uses Daily Allowance** or **Safety Cap only**, then test at
   least one video with the Child account.

Only videos longer than three minutes that permit embedded playback appear in
ZTube. New content can take a short time to populate while metadata is fetched.

## 7. Set up an iPad

### Add ZTube to the Home Screen

1. Open the ZTube hostname in Safari and sign in as the Child.
2. Tap **Share → Add to Home Screen**.
3. Leave **Open as Web App** enabled when that option is shown, then tap **Add**.
4. Launch ZTube from the new icon and confirm that sign-in and video playback
   work before applying stricter Screen Time rules.

### Close the direct YouTube routes

Menu names vary slightly by iPadOS release. Configure Screen Time as the parent,
set a Screen Time passcode the Child does not know, and then:

1. Delete the YouTube app. Under **Content & Privacy Restrictions**, prevent app
   installation if the Child must not reinstall it.
2. Under **Web Content**, choose **Limit Adult Websites** and add these entries
   to **Never Allow**:
   - `youtube.com`
   - `www.youtube.com`
   - `m.youtube.com`
   - `youtu.be`
3. Add your ZTube hostname to **Always Allow** if iPadOS offers that list.
4. Do not block `youtube-nocookie.com`, `googlevideo.com`, `ytimg.com`, or
   `gstatic.com`; ZTube's embedded player needs YouTube's privacy-enhanced player
   and media delivery hosts.
5. Test a ZTube video and separately confirm that Safari cannot open YouTube.
   If Screen Time blocks the embedded player too, allow the hostname named in
   the Screen Time prompt, then test direct youtube.com again.

For a short, supervised session, **Guided Access** can temporarily keep the iPad
inside the ZTube web app. It is optional and is not a replacement for Screen
Time or Cloudflare Access.

## Updates, backup, and rollback

Before an upgrade, export the remote database:

```bash
npx wrangler d1 export your-ztube-db --remote --output ztube-backup.sql
```

Store the export securely because it contains account emails and configuration.
Then update and deploy:

```bash
git pull --ff-only
npm install
npm run db:migrate:remote
npm run deploy
```

To inspect or roll back Worker code, use `npx wrangler versions list` and
`npx wrangler rollback`. A Worker rollback does not reverse D1 migrations.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `401` or repeated Access login | The Access application hostname, Allow policy, identity provider, and session are correct. |
| Admin opens the viewer instead of Admin | The exact signed-in email is present in the `ADMIN_EMAILS` Worker secret; update it with `wrangler secret put ADMIN_EMAILS`. |
| YouTube URLs cannot be added | The API key is valid, restricted to YouTube Data API v3, and has quota available. |
| A particular video is missing | It may be three minutes or shorter, private/deleted, or disallow embedded playback. |
| Player fails only on iPad | Test before and after Screen Time rules; allow the privacy-enhanced embed/media hosts, but keep direct YouTube blocked. |
| Database table error | Run `npm run db:migrate:remote` against the D1 database configured in this checkout. |

[access]: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
[d1]: https://developers.cloudflare.com/d1/get-started/
[domains]: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
[otp]: https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/
[youtube]: https://developers.google.com/youtube/v3/getting-started
