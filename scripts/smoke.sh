#!/usr/bin/env bash
# Probe the live site. Retries so a push can wait for Workers Builds.
# A healthy previous deploy can still make an early attempt succeed; the
# half-hour schedule is the backstop for a bad deploy that lands later.
set -euo pipefail

base="${SMOKE_BASE_URL:-https://quki.cc}"
timeout="${SMOKE_TIMEOUT_SECONDS:-300}"
interval="${SMOKE_INTERVAL_SECONDS:-15}"
deadline=$((SECONDS + timeout))

check() {
  local code body

  body=$(curl -sS --max-time 20 -w '\n%{http_code}' "$base/api/health") || {
    echo "GET /api/health failed"
    return 1
  }
  code=$(printf '%s\n' "$body" | tail -n 1)
  body=$(printf '%s\n' "$body" | sed '$d')
  if [ "$code" != "200" ]; then
    echo "GET /api/health HTTP $code: $(printf '%s' "$body" | head -c 300)"
    return 1
  fi
  if ! printf '%s' "$body" | jq -e '.ok == true and (.instruments | type == "number") and .instruments > 0' >/dev/null; then
    echo "GET /api/health rejected: $(printf '%s' "$body" | head -c 300)"
    return 1
  fi

  body=$(curl -sS --max-time 20 -w '\n%{http_code}' "$base/api/instruments") || {
    echo "GET /api/instruments failed"
    return 1
  }
  code=$(printf '%s\n' "$body" | tail -n 1)
  body=$(printf '%s\n' "$body" | sed '$d')
  if [ "$code" != "200" ]; then
    echo "GET /api/instruments HTTP $code: $(printf '%s' "$body" | head -c 300)"
    return 1
  fi
  if ! printf '%s' "$body" | jq -e '(.instruments | type == "array") and (.instruments | length) > 0' >/dev/null; then
    echo "GET /api/instruments rejected: $(printf '%s' "$body" | head -c 300)"
    return 1
  fi

  body=$(curl -sS --max-time 30 -w '\n%{http_code}' "$base/api/indices/H30269/overview") || {
    echo "GET /api/indices/H30269/overview failed"
    return 1
  }
  code=$(printf '%s\n' "$body" | tail -n 1)
  body=$(printf '%s\n' "$body" | sed '$d')
  if [ "$code" != "200" ]; then
    echo "GET /api/indices/H30269/overview HTTP $code: $(printf '%s' "$body" | head -c 300)"
    return 1
  fi
  if ! printf '%s' "$body" | jq -e '.lastClose != null and .lastClose != ""' >/dev/null; then
    echo "GET /api/indices/H30269/overview missing lastClose: $(printf '%s' "$body" | head -c 300)"
    return 1
  fi

  code=$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$base/") || {
    echo "GET / failed"
    return 1
  }
  if [ "$code" != "200" ]; then
    echo "GET / HTTP $code"
    return 1
  fi
}

while true; do
  if check; then
    echo "smoke ok: $base"
    exit 0
  fi
  if (( SECONDS >= deadline )); then
    echo "smoke failed: $base stayed unhealthy for ${timeout}s" >&2
    exit 1
  fi
  echo "retrying in ${interval}s ($((deadline - SECONDS))s left)"
  sleep "$interval"
done
