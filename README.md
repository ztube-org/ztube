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
- Identity-based authentication through Cloudflare Access

## Self-hosting

The complete [self-hosting guide](docs/self-hosting.md) walks through creating a
YouTube API key, provisioning Cloudflare D1 and Workers, protecting the service
with Cloudflare Access, creating family profiles, and configuring an iPad with
Home Screen and Screen Time restrictions.

Start from [`wrangler.example.jsonc`](wrangler.example.jsonc), not the
maintainer's deployment configuration.

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

ZTube enforces Approved Content and viewing allowances only inside the ZTube application; it does not block the YouTube website or app at the device level. For the explicitly authorized empty-database launch procedure, see [the zero-data rollout runbook](docs/operations/zero-data-rollout.md). The destructive reset is never part of normal deployment or verification.

## Tech Stack

- Vue 3 + Vue Router + Hono
- Cloudflare Workers + Worker Assets + D1
- Drizzle ORM
- Valibot
- Nuxt UI's standalone Vue plugin + Tailwind CSS
- YouTube Data API v3
