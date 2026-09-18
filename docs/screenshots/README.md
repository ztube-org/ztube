# README screenshots

These images show the real ZTube interface at an iPad landscape viewport
(1180 × 820 CSS pixels, captured at 2× resolution).

All accounts, titles, viewing activity and settings are fictional. The cover
illustrations are original SVG artwork defined in the capture script and are
covered by this repository's MIT license. They are examples, not bundled videos.

To regenerate from the current UI:

```sh
npm ci
npx playwright install chromium
npm run build
node scripts/readme-screenshots.mjs
```

The script opens a fresh browser context and supplies every page, asset and API
response locally. External requests, unrecognized API routes and mutations fail
the capture. It does not load a saved browser profile, read private configuration,
connect to a Worker or use a real media server. PNGs contain only the page viewport
and are re-encoded without metadata.

UI icon requests are also fulfilled locally from `scripts/fixtures/`. Those
fixtures come from Iconify's Heroicons and Lucide collections; their upstream
MIT/ISC notices are retained alongside the JSON files.

- `child-library.png`: approved YouTube content, progress and remaining time.
- `jellyfin-episodes.png`: seasons, episode progress and permanent unlocks.
- `parent-controls.png`: independent daily Time Pools and viewing controls.

Review the images after regeneration before committing them. Keep using reserved
example email addresses and synthetic content; never substitute a production
database, authentication cookie or live instance screenshot.
