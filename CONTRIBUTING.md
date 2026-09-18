# Contributing

Use Node.js 24 or newer. Follow [local setup](README.md#run-locally), then run
`npm run check` before proposing a change. Tests do not require production
credentials. Keep credentials, real family data and private deployment notes out
of commits and issue reports.

## Project structure

| Path | Responsibility |
| --- | --- |
| `app/` | Vue pages, components and composables |
| `src/` | Browser API, player adapters and UI/domain helpers |
| `server/app.ts` | API assembly and core application routes |
| `server/modules/` | Authentication, playback, Providers, catalogs and Time Pools |
| `server/database/` | Drizzle schema and shared database reads |
| `migrations/` | Ordered D1/SQLite migrations, including atomic playback/credit rules |
| `tests/ui/` | Playwright browser tests with isolated fixtures |
| `docs/adr/` | Architecture decisions; later ADRs may supersede earlier ones |

Use terms from [CONTEXT.md](CONTEXT.md). Keep authorization and accounting on the
server. Design for compact iPad layouts while preserving 44px touch targets.
Changes to playback, concurrency, authorization or migrations should have behavior
regressions, including an actual Workers/D1 test when runtime semantics matter.

## Useful commands

- `npm test`: server/browser-helper tests, including isolated SQLite and Workerd/D1.
- `npm run test:ui`: production build plus Playwright browser tests.
- `npm run lint` and `npm run typecheck`: static checks.
- `npm run cf:typegen`: regenerate Worker bindings after config/toolchain changes.
- `npm audit`: check the lockfile against current dependency advisories.

Do not run remote migrations, deployment or resets as part of ordinary testing.
Never rewrite an existing migration already used by a deployment; add a new one.
Check that a fresh database can apply the full sequence.

## Issues and pull requests

Use [GitHub Issues](https://github.com/ztube-org/ztube/issues) for reproducible bugs
and feature requests. Include expected/actual behavior, environment and a minimal
example. Remove emails, access tokens, signed playback URLs and server addresses
from logs. Follow [SECURITY.md](SECURITY.md) for vulnerabilities.

Keep pull requests focused, explain behavior changes and list verification.
Do not combine a large allowance-model rewrite with unrelated UI changes.
