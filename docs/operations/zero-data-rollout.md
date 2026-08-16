# Zero-data rollout

The initial time-control release is authorized to start from an empty ZTube database. This operation is destructive and opt-in. It is not part of migrations, deployment, builds, or tests.

## Enforcement boundary

ZTube authorizes and meters playback inside the ZTube application. It does not block the YouTube website or app at the device, browser, router, or operating-system level. Parents who need device-level blocking must configure it separately.

## Production procedure

1. Confirm that all current ZTube data is disposable and that affected families know they must recreate parents, Children, and Approved Content.
2. Deploy the application and apply all D1 migrations.
3. Stop normal use during the cutover.
4. Run `npm run db:clear -- --remote` from a trusted checkout authenticated to the intended Cloudflare account.
5. At the prompt, verify that the target says `REMOTE PRODUCTION`, then type the exact confirmation phrase. An omitted target, an invalid target, or a mismatched phrase exits without touching the database.
6. Sign in with a new parent identity. Create a Child and verify the defaults: UTC unless another fixed time zone is selected, 60 weekday minutes, 120 weekend minutes, and a 180-minute Safety Cap.
7. Add restricted and Allowance-Exempt Content. Verify that each can receive Playback Authorization and that its active playback accrues only to the corresponding bucket in today's Daily Usage Summary.
8. Verify that the parent dashboard reports only today's aggregate restricted and allowance-exempt usage.

Use `npm run db:clear -- --local` only when deliberately resetting the local Wrangler D1 store. Neither command is safe to place in ordinary verification or CI.

## What is removed

The operation removes all parents, Children, Approved Content, cached channel and playlist videos, Child time settings, Content Rules, Daily Usage Summaries, Temporary Extensions, and playback sessions. It preserves the schema and D1 migration history so the deployed application remains at the applied schema version.
