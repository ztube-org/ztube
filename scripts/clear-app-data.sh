#!/usr/bin/env bash
set -euo pipefail

target="${1:-}"
case "$target" in
  --local)
    target_label="LOCAL"
    wrangler_target="--local"
    ;;
  --remote)
    target_label="REMOTE PRODUCTION"
    wrangler_target="--remote"
    ;;
  *)
    echo "Usage: npm run db:clear -- --local|--remote" >&2
    exit 2
    ;;
esac

confirmation="CLEAR ${target_label} ZTUBE DATA"
echo "This permanently deletes all ZTube application data from ${target_label}."
echo "Migrations and database structure are preserved."
read -r -p "Type '${confirmation}' to continue: " answer
if [[ "$answer" != "$confirmation" ]]; then
  echo "Confirmation did not match; nothing was changed." >&2
  exit 1
fi

npx wrangler d1 execute DB "$wrangler_target" --file scripts/clear-app-data.sql
