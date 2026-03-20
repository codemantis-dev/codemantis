#!/bin/bash
# pre-build-clean.sh
# Removes the PRODUCTION data directory before each build so that
# development settings, API keys, and onboarding state never leak
# into a release package.  The .dev directory (used by `tauri dev`)
# is left untouched.

set -euo pipefail

PROD_DATA_DIR="${HOME}/Library/Application Support/dev.codemantis.app"

if [ -d "$PROD_DATA_DIR" ]; then
  echo "[pre-build] Cleaning production data directory: $PROD_DATA_DIR"
  rm -rf "$PROD_DATA_DIR"
else
  echo "[pre-build] Production data directory already clean."
fi
