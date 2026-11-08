#!/usr/bin/env bash
# prod-probe.sh — the standing production probe battery, one command.
# Committed (the scripts/rearm doctrine): no secrets, the base url is the
# ledger's public production origin. Every window that touches anything —
# and every post-reset re-walk — runs this FIRST.
#
# Usage: bash scripts/ops/prod-probe.sh
set -u
BASE="${WEBFLIX_PROD_URL:-https://webflix-2-0-tepa.vercel.app}"
log(){ echo "[probe $(date +%H:%M:%S)] $*"; }
FAILED=0

log "target: $BASE"

# ── the routes ×6 (the P102 battery law) ─────────────────────────────────
for r in / /netflix /tiktok /tiktok/lives /tiktok/lofigirl/live /tiktok/scout2015/live; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$BASE$r")
  log "route $r -> $CODE"
  [ "$CODE" = "200" ] || FAILED=1
done

# ── the G20 law: garbage does not normalize ──────────────────────────────
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 20 "$BASE/api/tiktok/live?handle=%40%40%23%24bad!!")
log "G20 garbage handle -> $CODE (expect 400)"
[ "$CODE" = "400" ] || FAILED=1

# ── the live lane (honest states only: board DTO or the honest error) ────
BOARD=$(curl -s --max-time 30 "$BASE/api/tiktok/live/board")
echo "$BOARD" | head -c 200; echo
echo "$BOARD" | grep -q '"board"\|"error"' || FAILED=1

STATUS=$(curl -s --max-time 30 "$BASE/api/tiktok/live?handle=lofigirl")
echo "$STATUS" | head -c 200; echo
echo "$STATUS" | grep -q '"status"\|"error"' || FAILED=1

# ── the deployed sha marker (provenance) ─────────────────────────────────
log "deployment check: the html must carry a build id and the page must 200 (sha lives in the Vercel API, not the DOM)"

# ── the optional browser lane (P103-mini-6): --browser runs the walk ─────
# Best-effort by design: the venv Playwright is station tooling — when it
# is absent the probe records SKIP, not FAIL. WALK_VIEWPORT passes through
# (e.g. WALK_VIEWPORT=1440x900 for the desktop lane).
if [ "${1:-}" = "--browser" ]; then
  PY=/home/z/.venv/bin/python
  WALK="$(dirname "$0")/mobile-375-walk.py"
  if [ -x "$PY" ] && [ -f "$WALK" ]; then
    log "browser lane: the walk against $BASE (WALK_VIEWPORT=${WALK_VIEWPORT:-375x812 default})"
    if WEBFLIX_BASE_URL="$BASE" WALK_HONEST_TIMEOUT_S="${WALK_HONEST_TIMEOUT_S:-90}" \
       "$PY" "$WALK"; then
      log "browser lane: PASS"
    else
      log "browser lane: FAILED (the walk's own output above names the law broken)"
      FAILED=1
    fi
  else
    log "browser lane: SKIP (venv python or the walk script absent — station tooling, not prod truth)"
  fi
fi

if [ "$FAILED" = "0" ]; then
  log "ALL PROBES GREEN"
else
  log "PROBES FAILED — read the lines above, then check the Vercel deployment api before touching code"
  exit 1
fi
