#!/usr/bin/env bash
# On macOS, remove quarantine/provenance and ad-hoc sign the Electron dev binary
# so "Electron quit unexpectedly" does not occur when running npm run start:desktop.
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
ELECTRON_APP="${REPO_ROOT}/node_modules/electron/dist/Electron.app"

if [ ! -d "$ELECTRON_APP" ]; then
  # Electron may be hoisted under packages/electron in some installs
  ELECTRON_APP="${REPO_ROOT}/packages/electron/node_modules/electron/dist/Electron.app"
fi

if [ ! -d "$ELECTRON_APP" ]; then
  echo "==> Electron.app not found; run npm install and try again."
  exit 0
fi

has_quarantine_attrs=0
if xattr -r "$ELECTRON_APP" 2>/dev/null | rg -q "com\\.apple\\.(quarantine|provenance)"; then
  has_quarantine_attrs=1
fi

signature_ok=0
if codesign --verify --deep --strict "$ELECTRON_APP" >/dev/null 2>&1; then
  signature_ok=1
fi

if [ "$has_quarantine_attrs" -eq 0 ] && [ "$signature_ok" -eq 1 ]; then
  echo "==> Electron dev binary already healthy; skipping re-sign."
  exit 0
fi

echo "==> Repairing macOS Electron dev binary: $ELECTRON_APP"

if [ "$has_quarantine_attrs" -eq 1 ]; then
  echo "==> Removing quarantine/provenance attributes"
  xattr -cr "$ELECTRON_APP"
fi

if [ "$signature_ok" -eq 0 ]; then
  echo "==> Re-signing Electron.app ad-hoc (one-time per changed binary)"
  codesign --force --deep --sign - "$ELECTRON_APP"
fi

echo "==> Done."
