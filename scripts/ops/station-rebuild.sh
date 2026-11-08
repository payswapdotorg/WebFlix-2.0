#!/usr/bin/env bash
# station-rebuild.sh — the post-reset discipline, committed so no window
# ever re-derives it again (the eighteenth reset cost a full session of
# rediscovery; the nineteenth gets one command).
#
# SANITIZED (the scripts/rearm doctrine): no secret values in this file —
# the vault lives at /home/z/.secrets/webflix.env (0600) and is seeded BY
# HAND from the operator's message each reset (the operator says the keys
# are never re-sent on demand; this script only VERIFIES the shape).
#
# Usage:
#   bash scripts/ops/station-rebuild.sh [--gates-only] [--skip-gates]
#
# Idempotent: an intact repo (correct remote, clean tree) is DETECTED and
# the clone step is skipped; a busy :3000 dev server is detected and the
# boot step is skipped. Gates always run unless --skip-gates.
set -u

REPO="git@github.com:payswapdotorg/WebFlix-2.0.git"
CLONE_URL="https://github.com/payswapdotorg/WebFlix-2.0.git"
BASE=/home/z
DIR=$BASE/my-project
VAULT=$BASE/.secrets/webflix.env
DEV_LOG=$DIR/dev.log
DB_URL="file:../db/webflix2.db"

GATES_ONLY=0; SKIP_GATES=0
for arg in "$@"; do
  case "$arg" in
    --gates-only) GATES_ONLY=1 ;;
    --skip-gates) SKIP_GATES=1 ;;
    *) echo "unknown arg: $arg"; exit 2 ;;
  esac
done

log(){ echo "[rebuild $(date +%H:%M:%S)] $*"; }
fail(){ echo "[rebuild FATAL] $*"; exit 1; }

# ── 1. the vault (names only — values are the operator's) ────────────────
EXPECTED_KEYS=(GITHUB_PAT GITHUB_PAT_FALLBACK VERCEL_TOKEN VERCEL_TOKEN_FALLBACK
  NEON_API_KEY OPENROUTER_API_KEY E2B_API_KEY APIFY_API_KEY
  COMPOSIO_API_KEY COMPOSIO_MCP_API_KEY
  UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN UPSTASH_MCP_API_KEY
  CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN CLOUDFLARE_R2_ACCESS_KEY_ID
  CLOUDFLARE_R2_SECRET_ACCESS_KEY CLOUDFLARE_R2_S3_ENDPOINT)

if [ -f "$VAULT" ]; then
  PERM=$(stat -c %a "$VAULT" 2>/dev/null || echo "?")
  [ "$PERM" = "600" ] || { log "vault perms are $PERM — tightening to 600"; chmod 600 "$VAULT"; }
  MISSING=0
  for k in "${EXPECTED_KEYS[@]}"; do
    grep -q "^export $k=" "$VAULT" || { log "vault MISSING key: $k"; MISSING=1; }
  done
  [ "$MISSING" = "0" ] && log "vault OK (${#EXPECTED_KEYS[@]} key names present, 0600)" \
                          || log "vault INCOMPLETE — seed from the operator's message before pushing/deploying"
else
  fail "vault absent at $VAULT — seed it from the operator's message first (names: ${EXPECTED_KEYS[*]})"
fi

if [ "$GATES_ONLY" = "1" ]; then
  log "--gates-only: skipping clone/install/boot"
else
  # ── 2. the repo (the upload-mount trick: clear all but `upload`) ───────
  if git -C "$DIR" rev-parse --git-dir >/dev/null 2>&1 \
     && git -C "$DIR" remote get-url origin 2>/dev/null | grep -q "WebFlix-2.0"; then
    log "repo intact at $DIR (HEAD $(git -C "$DIR" rev-parse --short HEAD 2>/dev/null || echo '?')) — clone skipped"
  else
    log "restoring WebFlix-2.0 into $DIR (preserving the upload mount)"
    rm -rf "$BASE/webflix-clone"
    git clone --depth 50 "$CLONE_URL" "$BASE/webflix-clone" || fail "clone failed (check GITHUB_PAT in the vault)"
    find "$DIR" -mindepth 1 -maxdepth 1 ! -name upload -exec rm -rf {} + 2>/dev/null
    cp -a "$BASE/webflix-clone/." "$DIR/"
    rm -rf "$BASE/webflix-clone"
    log "repo restored (HEAD $(git -C "$DIR" rev-parse --short HEAD))"
  fi

  # ── 3. deps + local db ─────────────────────────────────────────────────
  cd "$DIR" || fail "cannot cd $DIR"
  log "bun install"
  bun install 2>&1 | tail -1
  # local .env: the dev/tests sqlite (the prod Neon url NEVER lives here)
  if ! grep -q "^DATABASE_URL=" .env 2>/dev/null; then
    printf 'DATABASE_URL=%s\n' "$DB_URL" > .env
    log ".env written (local sqlite only)"
  fi
  mkdir -p db
  log "prisma db push + generate"
  bunx prisma db push --skip-generate 2>&1 | tail -1
  bunx prisma generate 2>&1 | tail -1

  # ── 4. the dev server (setsid, NO pipe — a pipe dies with the shell) ───
  if curl -s -o /dev/null --max-time 2 http://localhost:3000/; then
    log "dev server already answering on :3000 — boot skipped"
  else
    log "booting dev server (log: $DEV_LOG)"
    (setsid env DATABASE_URL="$DB_URL" bun run dev > "$DEV_LOG" 2>&1 < /dev/null &)
    sleep 12
    curl -s -o /dev/null -w "local / -> %{http_code}\n" http://localhost:3000/ || fail "dev server did not come up (read $DEV_LOG)"
  fi
fi

[ "$SKIP_GATES" = "1" ] && { log "--skip-gates: done"; exit 0; }

# ── 5. the gates (tsc / eslint / FULL battery) ───────────────────────────
cd "$DIR" || fail "cannot cd $DIR"
log "gate 1/3: tsc"
bun run typecheck >/dev/null 2>&1 && log "tsc 0" || fail "tsc FAILED"
log "gate 2/3: eslint"
bun run lint >/dev/null 2>&1 && log "eslint 0/0" || fail "eslint FAILED"
log "gate 3/3: FULL battery (this takes a few minutes)"
BLOG=/tmp/station-battery.log
bun run test > "$BLOG" 2>&1
EXIT=$?
PASS=$(grep -E "^\s*[0-9]+ pass" "$BLOG" | awk '{p+=$1} END {print p+0}')
FAIL=$(grep -E "^\s*[0-9]+ fail" "$BLOG" | awk '{p+=$1} END {print p+0}')
if [ "$EXIT" = "0" ]; then
  log "FULL battery: $PASS pass / $FAIL fail, exit 0"
else
  fail "FULL battery FAILED ($PASS pass / $FAIL fail, exit $EXIT) — read $BLOG"
fi

# ── 6. the discipline checklist ──────────────────────────────────────────
cat <<'EOF'

[rebuild] STATION REBUILT. The remaining discipline is MANUAL, by law:
  1. Re-probe production (bash scripts/ops/prod-probe.sh) — the deploy is
     untouched by a sandbox reset, but the honesty laws demand a re-walk.
  2. Record the reset in docs/plans/wave-claims.md + WORKLOG.md
     (the reset number, what was rebuilt, the gate numbers).
  3. NEVER trust a stale vault: the GITHUB/Vercel/Apify keys above must be
     probed (cheap GET endpoints) before any push/deploy/spend.
EOF
