# ZTube

A parental control YouTube platform for curating content for children.

## Features

- Parents manage allowlists of YouTube channels, playlists, and videos
- Children browse and watch only approved content
- Clean, distraction-free video player with speed controls
- Admin panel for account management

## Local Development

1. Clone and install:
   ```bash
   npm install
   ```

2. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env with your values
   ```

3. Initialize database:
   ```bash
   npm run db:push
   ```

4. Start dev server:
   ```bash
   npm run dev
   ```

5. Open http://localhost:3000

## Deployment to Cloudflare

1. Create D1 database:
   ```bash
   wrangler d1 create ztube-prod
   ```

2. Update `wrangler.toml` with database_id

3. Set secrets:
   ```bash
   wrangler secret put SUPERADMIN_PASSWORD
   wrangler secret put INVITATION_CODE
   wrangler secret put YOUTUBE_API_KEY
   wrangler secret put NUXT_SESSION_PASSWORD
   ```

4. Run migrations:
   ```bash
   wrangler d1 migrations apply ztube-prod --remote
   ```

5. Deploy:
   ```bash
   npm run build
   wrangler pages deploy .output/public
   ```

## Tech Stack

- Nuxt 3 + Vue 3
- Cloudflare Pages + Workers + D1
- Drizzle ORM
- Nuxt UI + Tailwind CSS
- YouTube Data API v3
