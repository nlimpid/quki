#!/usr/bin/env bash
# Live TiDB checks. Without TIDB_CI_DATABASE_URL the suite skips and exits 0.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

ci_url="${TIDB_CI_DATABASE_URL:-}"
if [ -z "${ci_url//[[:space:]]/}" ]; then
  echo "NOTICE: TIDB_CI_DATABASE_URL is not set. Live TiDB tests will be skipped."
  echo "CI loads it from 1Password (op://quki-ci/tidb-quki-ci/database_url)."
  echo "Locally: export TIDB_CI_DATABASE_URL=\"\$(op read 'op://quki-ci/tidb-quki-ci/database_url')\""
fi

exec "$root/node_modules/.bin/vitest" run --config vitest.integration.config.ts
