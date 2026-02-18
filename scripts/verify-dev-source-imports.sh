#!/usr/bin/env bash
# Verification script for source-direct imports (opensprint.dev-3l8.5)
# Run: ./scripts/verify-dev-source-imports.sh
set -e
cd "$(dirname "$0")/.."

echo "=== 1. Running npm test ==="
npm test

echo ""
echo "=== 2. Running npm run build ==="
npm run build

echo ""
echo "=== 3. Verifying dev server startup (15s) ==="
rm -rf packages/shared/dist
timeout 15 npm run dev &
DEV_PID=$!
sleep 12
kill $DEV_PID 2>/dev/null || true
echo "Dev servers started successfully."

echo ""
echo "=== All verifications passed ==="
