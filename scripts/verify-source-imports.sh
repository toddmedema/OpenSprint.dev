#!/usr/bin/env bash
# Verification script for source-direct imports (opensprint.dev-3l8.5).
# Run: ./scripts/verify-source-imports.sh
# Or: npm run verify:source
#
# Verifies:
# 1. npm test passes (all tests use source via vitest aliases)
# 2. Dev script removes shared/dist so backend resolves to source
# 3. Frontend Vite aliases @opensprint/shared to source
# 4. npm run build produces working production build
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== 1. Running all tests (npm test) ==="
npm test

echo ""
echo "=== 2. Verifying dev server config (dist removal ensures source resolution) ==="
# Dev script must remove shared/dist so backend resolves to source
DEV_SCRIPT=$(node -e "console.log(require('./package.json').scripts.dev)")
if [[ "$DEV_SCRIPT" != *"rm -rf packages/shared/dist"* ]]; then
  echo "ERROR: dev script must remove packages/shared/dist before starting"
  exit 1
fi
echo "OK: dev script removes shared/dist"

echo ""
echo "=== 3. Verifying frontend Vite alias to source ==="
if ! grep -q "shared/src/index.ts" packages/frontend/vite.config.ts; then
  echo "ERROR: frontend vite.config must alias @opensprint/shared to shared/src/index.ts"
  exit 1
fi
echo "OK: frontend aliases @opensprint/shared to source"

echo ""
echo "=== 4. Running production build (npm run build) ==="
npm run build

echo ""
echo "=== 5. Verifying build output ==="
test -f packages/shared/dist/index.js || { echo "ERROR: packages/shared/dist/index.js missing"; exit 1; }
test -f packages/backend/dist/index.js || { echo "ERROR: packages/backend/dist/index.js missing"; exit 1; }
test -d packages/frontend/dist || { echo "ERROR: packages/frontend/dist missing"; exit 1; }
echo "OK: all build outputs present"

echo ""
echo "=== 6. Optional: verify dev servers start (VERIFY_DEV=1) ==="
if [ "${VERIFY_DEV:-0}" = "1" ]; then
  echo "Starting dev servers..."
  npm run dev &
  DEV_PID=$!
  cleanup() { kill $DEV_PID 2>/dev/null || true; }
  trap cleanup EXIT
  for i in $(seq 1 30); do
    if curl -s http://localhost:3100/health 2>/dev/null | grep -q '"status":"ok"'; then
      if curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/ 2>/dev/null | grep -qE '^200|^304'; then
        echo "OK: both backend and frontend are up"
        break
      fi
    fi
    [ $i -eq 30 ] && echo "WARN: servers may not have started in time"
    sleep 0.5
  done
else
  echo "Skip (set VERIFY_DEV=1 to run dev server startup check)"
fi

echo ""
echo "=== All verifications passed ==="
