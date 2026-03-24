#!/usr/bin/env bash
# Start backend + frontend, wait until health endpoints respond, then run perf:ci.
# Used by merge-gate and release-desktop perf jobs so readiness logic stays in one place.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

export NODE_ENV="${NODE_ENV:-test}"

BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://localhost:3100/health}"
FRONTEND_HEALTH_URL="${FRONTEND_HEALTH_URL:-http://localhost:5173/}"
BACKEND_WAIT_SECS="${BACKEND_WAIT_SECS:-45}"
FRONTEND_WAIT_SECS="${FRONTEND_WAIT_SECS:-45}"
SLEEP_SECS="${PERF_HEALTH_SLEEP_SECS:-1}"

wait_http() {
  local name="$1" url="$2" max_iters="$3"
  local i
  for i in $(seq 1 "$max_iters"); do
    if curl -sf "$url" >/dev/null 2>&1; then
      return 0
    fi
    if [ "$i" -eq "$max_iters" ]; then
      echo "${name} health check timeout" >&2
      return 1
    fi
    sleep "$SLEEP_SECS"
  done
}

node scripts/ci/wait-for-tcp.mjs 127.0.0.1 5432 60

npm run start -w packages/backend &
wait_http "Backend" "$BACKEND_HEALTH_URL" "$BACKEND_WAIT_SECS"

npm run dev -w packages/frontend &
wait_http "Frontend" "$FRONTEND_HEALTH_URL" "$FRONTEND_WAIT_SECS"

npm run perf:ci
