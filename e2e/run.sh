#!/usr/bin/env bash
# Starts a throwaway production server with demo accounts and runs the browser smoke test.
# Requires `npm run build` first. Usage: e2e/run.sh [screenshotDir]
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f e2e/fixtures/vertical.mp4 ] || e2e/make-fixtures.sh
PORT=${PORT:-3199}
if curl -s -o /dev/null "http://localhost:$PORT/login"; then echo "port $PORT already in use" >&2; exit 1; fi
DATA=$(mktemp -d)
PUBLIC_URL=http://localhost:$PORT APP_PASSWORD=e2e-pass SECRET_KEY=e2e-secret-key-0123456789abcdef0123 \
  DATA_DIR=$DATA ENABLE_DEMO_ACCOUNTS=true setsid node node_modules/next/dist/bin/next start -p "$PORT" > "$DATA/server.log" 2>&1 &
SERVER=$!
trap 'kill -- -$SERVER 2>/dev/null; rm -rf "$DATA"' EXIT
for _ in $(seq 1 30); do curl -s -o /dev/null "http://localhost:$PORT/login" && break; sleep 1; done
BASE_URL=http://localhost:$PORT APP_PASSWORD=e2e-pass node e2e/smoke.mjs "${1:-}"
