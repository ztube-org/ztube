# ZTube

A curated YouTube viewer with server-enforced content and viewing controls for Children.

## Features

- Admins manage Approved Content, Content Rules, tags, profiles, and reusable Child configurations
- Children browse and watch only Approved Content, with search, Favorites, Recommendations, and Continue Watching
- Server-authoritative Daily Allowances and separate Safety Caps for Allowance-Exempt Content
- Viewing Windows, Required Breaks, and current-day Viewing Pause controls
- Privacy-preserving 7/30-day Daily Usage Summaries without per-video viewing history
- Six-hour content freshness with scheduled background sync and Admin force-sync/preview controls
- Clean, distraction-free video player
- Google authentication through Cloudflare Access

## Local Development

1. Clone and install:
   ```bash
   npm install
   ```

2. Configure Worker secrets for local development:
   ```bash
   cp .dev.vars.example .dev.vars
   # Edit .dev.vars with your local values
   ```

3. Initialize the local D1 database:
   ```bash
   npm run db:migrate:local
   ```

4. Start dev server:
   ```bash
   npm run dev
   ```

5. Open http://localhost:5173

## Deployment to Cloudflare Worker

1. Create D1 database:
   ```bash
   npx wrangler d1 create ztube-db
   ```

2. Replace `REPLACE_WITH_D1_DATABASE_ID` in `wrangler.jsonc` with the returned database ID.

3. Set secrets:
   ```bash
   npx wrangler secret put YOUTUBE_API_KEY
   npx wrangler secret put ADMIN_EMAILS
   ```

4. Run migrations:
   ```bash
   npm run db:migrate:remote
   ```

5. Deploy:
   ```bash
   npm run deploy
   ```

6. In Cloudflare Zero Trust, create a self-hosted Access application for
   `ztube.txchen.win`, select Google as the identity provider, and add an Allow
   policy for every Admin and Child who may use ZTube. The Worker trusts the
   `Cf-Access-Authenticated-User-Email` header injected by Access, so do not
   expose another public route that bypasses Access.

Every authenticated identity automatically receives a Child profile on first
sign-in. Emails listed in `ADMIN_EMAILS` additionally receive Admin capability
and can manage every Child; accounts are not created manually in ZTube.

ZTube enforces Approved Content and viewing allowances only inside the ZTube application; it does not block the YouTube website or app at the device level. For the explicitly authorized empty-database launch procedure, see [the zero-data rollout runbook](docs/operations/zero-data-rollout.md). The destructive reset is never part of normal deployment or verification.

## Tech Stack

- Vue 3 + Vue Router + Hono
- Cloudflare Workers + Worker Assets + D1
- Drizzle ORM
- Valibot
- Nuxt UI's standalone Vue plugin + Tailwind CSS
- YouTube Data API v3
