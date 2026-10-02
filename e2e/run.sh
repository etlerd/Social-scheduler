#!/usr/bin/env bash
# Starts throwaway production servers with demo accounts and runs the browser tests.
# Requires `npm run build` first. Usage: e2e/run.sh [screenshotDir]
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f e2e/fixtures/photo-large.jpg ] || e2e/make-fixtures.sh
PIDS=(); DIRS=()
trap 'for p in "${PIDS[@]}"; do kill -- -$p 2>/dev/null || true; done; rm -rf "${DIRS[@]}"' EXIT

start() { # port, extra env...
  local port=$1; shift
  if curl -s -o /dev/null "http://localhost:$port/login"; then echo "port $port already in use" >&2; exit 1; fi
  local data; data=$(mktemp -d); DIRS+=("$data")
  env PUBLIC_URL=http://localhost:$port APP_PASSWORD=e2e-pass SECRET_KEY=e2e-secret-key-0123456789abcdef0123 \
    DATA_DIR=$data ENABLE_DEMO_ACCOUNTS=true "$@" setsid node node_modules/next/dist/bin/next start -p "$port" > "$data/server.log" 2>&1 &
  PIDS+=($!)
  for _ in $(seq 1 30); do curl -s -o /dev/null "http://localhost:$port/login" && return; sleep 1; done
}

start 3199
BASE_URL=http://localhost:3199 APP_PASSWORD=e2e-pass node e2e/smoke.mjs "${1:-}"
start 3198 STORAGE_LIMIT_GB=0.01025390625
BASE_URL=http://localhost:3198 APP_PASSWORD=e2e-pass node e2e/storage.mjs "${1:-}"
