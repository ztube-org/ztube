# ZTube

A parental control YouTube platform for curating content for children.

## Features

- Parents manage allowlists of YouTube channels, playlists, and videos
- Children browse and watch only approved content
- Clean, distraction-free video player with speed controls
- Admin panel for account management
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
   policy for every parent and child who may use ZTube. The Worker trusts the
   `Cf-Access-Authenticated-User-Email` header injected by Access, so do not
   expose another public route that bypasses Access.

The first non-admin Google identity to visit ZTube becomes a parent. A parent
adds each child using the child's Google email before that child signs in.
Administrator emails are configured in `wrangler.jsonc` via `ADMIN_EMAILS`.

## Tech Stack

- Vue 3 + Vue Router + Hono
- Cloudflare Workers + Worker Assets + D1
- Drizzle ORM
- Nuxt UI's standalone Vue plugin + Tailwind CSS
- YouTube Data API v3
