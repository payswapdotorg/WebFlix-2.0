#!/usr/bin/env bash
#
# WFX2-C-W — acceptance harness wrapper.
#
#   ./scripts/acceptance.sh                # against ACCEPT_URL (default: production)
#   ./scripts/acceptance.sh --selftest     # hermetic dry-run (mock server, loopback)
#
# Exits non-zero on any failed check. See scripts/acceptance.mjs for the
# full check inventory.
#
set -euo pipefail
cd "$(dirname "$0")/.."

if command -v bun >/dev/null 2>&1; then
  exec bun scripts/acceptance.mjs "$@"
fi
exec node scripts/acceptance.mjs "$@"
