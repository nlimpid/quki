#!/usr/bin/env bash
# Live TiDB checks. Without TIDB_CI_DATABASE_URL the suite skips and exits 0.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

ci_url="${TIDB_CI_DATABASE_URL:-}"
if [ -z "${ci_url//[[:space:]]/}" ]; then
  echo "NOTICE: TIDB_CI_DATABASE_URL is not set. Live TiDB tests will be skipped."
  echo "Create a separate database such as quki_ci (never production quki) and export its connection string to run them."
fi

exec "$root/node_modules/.bin/vitest" run --config vitest.integration.config.ts
