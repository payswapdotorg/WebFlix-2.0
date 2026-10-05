#!/usr/bin/env bash
# rearm2.sh — idempotent Tier-2 chain re-arm (quick-tunnel route mode)
# Layers: secret -> Xvfb -> Chrome CDP -> login(full) -> broker :3055 -> quick tunnel -> env sync on rotation -> verify
# LIGHT=1 (watchdog): skips login-revive + e2e action. Rotation sync ALWAYS active.
set -u
PY=/home/z/.venv/bin/python3; command -v "$PY" >/dev/null 2>&1 || PY=python3
ENVF=/home/z/.payswap-env
[ -f "$ENVF" ] && { set -a; . "$ENVF"; set +a; } 2>/dev/null
BDIR=/home/z/webflix-2.0/mini-services/youtube-broker
SFILE=/tmp/.broker_secret
CDP=http://127.0.0.1:9222
EID=BWVN2w1WGC744u2n
PROJ=webflix-2-0
CHROME_BIN="$(command -v google-chrome || command -v google-chrome-stable || true)"
[ -n "$CHROME_BIN" ] || CHROME_BIN="$(ls /home/z/.cache/ms-playwright/chromium-*/chrome-linux/chrome 2>/dev/null | tail -1)"
CF_BIN="$(command -v cloudflared || true)"; [ -n "$CF_BIN" ] || CF_BIN=/home/z/tools/cloudflared
log(){ echo "[$(date +%H:%M:%S)] $*"; }
jget(){ "$PY" -c "import sys,json;d=json.load(sys.stdin);print(d$1)" 2>/dev/null; }

if [ ! -s "$SFILE" ]; then
  log "recovering BROKER_SECRET from Vercel"
  E=$(curl -s -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v9/projects/$PROJ/env" | jget "['envs']" | "$PY" -c 'import sys,json;es=json.load(sys.stdin);print(next((e["id"] for e in es if e.get("key")=="BROKER_SECRET"),""))' 2>/dev/null)
  [ -n "$E" ] || E=XbkH63tk0GUY32jf
  curl -s -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v10/projects/$PROJ/env/$E?decrypt=true" | jget "['value']" > "$SFILE"
  chmod 600 "$SFILE"
fi
SECRET="$(cat "$SFILE" 2>/dev/null || true)"
[ -n "$SECRET" ] || { log "FATAL: BROKER_SECRET unavailable"; exit 1; }

pgrep -x Xvfb >/dev/null || { log "start Xvfb :99"; setsid nohup Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >/tmp/xvfb.log 2>&1 & sleep 2; }

curl -s --max-time 3 "$CDP/json/version" >/dev/null || {
  log "start Chrome CDP :9222 (persistent profile)"
  mkdir -p /home/z/tools/chrome-profile
  DISPLAY=:99 setsid nohup "$CHROME_BIN" --remote-debugging-port=9222 --user-data-dir=/home/z/tools/chrome-profile \
    --no-first-run --no-default-browser-check --disable-popup-blocking --no-sandbox \
    --disable-blink-features=AutomationControlled --window-size=1440,900 about:blank >/tmp/chrome_cdp.log 2>&1 &
  sleep 4
}
curl -s --max-time 3 "$CDP/json/version" >/dev/null || { log "FATAL: CDP down"; exit 1; }

if [ "${LIGHT:-0}" != "1" ]; then
  OUT="$("$PY" /home/z/tools/verify_login.py 2>/dev/null || true)"
  echo "$OUT" | grep -q "LOGIN_VERIFIED=true" || { log "login missing -> login flow"; "$PY" /home/z/tools/youtube_login.py 2>&1 | tail -5; }
fi

curl -s --max-time 3 http://127.0.0.1:3055/healthz 2>/dev/null | grep -q '"ok":true' || {
  log "start broker :3055"
  ( cd "$BDIR" && setsid nohup env BROKER_SECRET="$SECRET" CDP_HTTP=$CDP bun start >/tmp/broker.log 2>&1 & )
  sleep 3
}
curl -s --max-time 3 http://127.0.0.1:3055/healthz 2>/dev/null | grep -q '"ok":true' || { log "FATAL: broker down"; tail -5 /tmp/broker.log 2>/dev/null; exit 1; }

[ -x "$CF_BIN" ] || { log "download cloudflared"; mkdir -p /home/z/tools; curl -sL -o "$CF_BIN" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x "$CF_BIN"; }
pgrep -f "cloudflared tunnel" >/dev/null || {
  log "start quick tunnel"
  setsid nohup "$CF_BIN" tunnel --url http://127.0.0.1:3055 >/tmp/cloudflared.log 2>&1 &
  sleep 12
}
QT="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cloudflared.log 2>/dev/null | tail -1)"
[ -n "$QT" ] || { log "FATAL: no quick tunnel URL"; tail -8 /tmp/cloudflared.log 2>/dev/null; exit 1; }
echo "$QT" > /tmp/.quicktunnel_url

CUR="$(curl -s -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v10/projects/$PROJ/env/$EID?decrypt=true" | jget "['value']")"
if [ -n "$CUR" ] && [ "$QT" != "$CUR" ]; then
  if curl -s --max-time 20 "$QT/healthz" 2>/dev/null | grep -q '"ok":true'; then
    log "tunnel URL rotated -> PATCH BROKER_URL + trigger deploy"
    curl -s -X PATCH -H "Authorization: Bearer $VERCEL_TOKEN" -H "content-type: application/json" "https://api.vercel.com/v9/projects/$PROJ/env/$EID" -d "{\"value\":\"$QT\"}" >/dev/null
    curl -s -f -X POST -H "Authorization: Bearer $VERCEL_TOKEN" -H "content-type: application/json" "https://api.vercel.com/v13/deployments" -d "{\"name\":\"$PROJ\",\"target\":\"production\",\"gitSource\":{\"type\":\"github\",\"repoId\":$(cat /tmp/.gh_repo_id 2>/dev/null || echo 1393882125),\"ref\":\"main\"}}" >/dev/null || curl -s -f -X POST "$(cat /tmp/.vercel_deploy_hook 2>/dev/null)" >/dev/null 2>&1 || { git -C /home/z/webflix-2.0 commit --allow-empty -m "chore: watchdog retrigger (broker route cutover)" >/dev/null 2>&1 && git -C /home/z/webflix-2.0 push origin main >/dev/null 2>&1; }
  else
    log "WARN: new tunnel URL not healthy; keeping env value"
  fi
fi

log "local  healthz: $(curl -s --max-time 5 http://127.0.0.1:3055/healthz)"
PUB="$(curl -s --max-time 25 "$QT/healthz")"
if ! echo "$PUB" | grep -q '"ok":true'; then
  if curl -s --max-time 3 http://127.0.0.1:3055/healthz 2>/dev/null | grep -q '"ok":true'; then
    log "public down but local OK -> restart quick tunnel"
    pkill -f "cloudflared tunnel" || true; sleep 2
    setsid nohup "$CF_BIN" tunnel --url http://127.0.0.1:3055 >/tmp/cloudflared.log 2>&1 &
    sleep 12
    QT="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/cloudflared.log 2>/dev/null | tail -1)"
    [ -n "$QT" ] && echo "$QT" > /tmp/.quicktunnel_url
    PUB="$(curl -s --max-time 25 "$QT/healthz" 2>/dev/null)"
    log "public healthz (after tunnel restart): $PUB"
  fi
fi
echo "$PUB" | grep -q '"ok":true' || { log "FATAL: public healthz failed"; exit 1; }

if [ "${LIGHT:-0}" != "1" ]; then
  ACT="$(curl -s --max-time 60 -X POST "$QT/broker/action" -H "x-broker-secret: $SECRET" -H "x-session-id: webflix-producer" -H "content-type: application/json" -d '{"kind":"fetch","path":"/"}')"
  log "e2e fetch: $(echo "$ACT" | head -c 300)"
  echo "$ACT" | grep -q '"ok":true' || { log "WARN: e2e action not ok"; exit 2; }
fi

# prod-sync: heal stale production deployments (never while a build is in flight)
MAINSHA="$(git -C /home/z/webflix-2.0 rev-parse --short=7 HEAD 2>/dev/null)"
NEWEST="$(curl -s -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v6/deployments?projectId=prj_QY8FWgOOcEHAXnkpeyqBFidsHlhj&limit=5" 2>/dev/null | "$PY" -c '
import sys,json
try:
    ds=json.load(sys.stdin).get("deployments") or []
    if not ds: print("NONE"); raise SystemExit
    states=[d.get("state") for d in ds]
    top=ds[0]
    sha=(top.get("meta") or {}).get("githubCommitSha","?")
    print(("BUILDING "+sha[:7]) if any(s in ("QUEUED","BUILDING","PENDING","INITIALIZING") for s in states) else ("READY "+sha[:7]))
except SystemExit: pass
except Exception: print("ERR")')"
case "$NEWEST" in
  BUILDING*|NONE|ERR) log "prod-sync: build in flight or unknown ($NEWEST) - no action" ;;
  READY*)
    PRODSHA="${NEWEST#READY }"
    if [ -n "$MAINSHA" ] && [ "$PRODSHA" != "$MAINSHA" ]; then
      log "prod-sync: production at $PRODSHA < local main $MAINSHA -> trigger deploy chain"
      TRIG="$(curl -s -X POST -H "Authorization: Bearer $VERCEL_TOKEN" -H "content-type: application/json" "https://api.vercel.com/v13/deployments" -d "{\"name\":\"$PROJ\",\"target\":\"production\",\"gitSource\":{\"type\":\"github\",\"repoId\":$(cat /tmp/.gh_repo_id 2>/dev/null || echo 1393882125),\"ref\":\"main\"}}" 2>/dev/null | head -c 120)"
      log "prod-sync: api trigger: $TRIG"
      case "$TRIG" in
        *402*|*payment_required*)
          if [ -s /tmp/.vercel_deploy_hook ]; then
            log "prod-sync: quota-limited -> deploy hook"
            curl -s -f -X POST "$(cat /tmp/.vercel_deploy_hook)" >/dev/null 2>&1 || { cd /home/z/webflix-2.0 && git commit --allow-empty -m "chore: retrigger deploy (prod-sync)" >/dev/null 2>&1 && git push origin main >/dev/null 2>&1; }
          fi
          ;;
      esac
    else
      log "prod-sync: production current ($PRODSHA)"
    fi
    ;;
esac

log "CHAIN ARMED (quick-tunnel route): chrome:9222 -> broker:3055 -> $QT"
