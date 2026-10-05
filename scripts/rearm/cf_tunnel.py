#!/usr/bin/env python3
# cf_tunnel.py — ensure the webflix-broker named tunnel exists w/ correct ingress + DNS; prints connector TOKEN to stdout (consumed by rearm.sh — never echo it).
import json, os, sys, urllib.request, urllib.error

def load_env():
    for line in open("/home/z/.payswap-env"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k, v)

def api(method, path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request("https://api.cloudflare.com/client/v4" + path, data=body, method=method,
        headers={"Authorization": "Bearer " + os.environ["CLOUDFLARE_API_TOKEN"], "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try: return json.load(e)
        except Exception: return {"success": False, "errors": [str(e)]}

load_env()
acct = os.environ["CLOUDFLARE_ACCOUNT_ID"]
HOSTNAME = "webflix-broker.flauz.app"
SERVICE = "http://localhost:3055"

tunnels = api("GET", f"/accounts/{acct}/tunnels?is_deleted=false").get("result") or []
t = next((x for x in tunnels if "broker" in (x.get("name") or "").lower()), None)
if t is None:
    r = api("POST", f"/accounts/{acct}/tunnels", {"name": "webflix-broker", "config_src": "cloudflare"})
    t = r.get("result") or {}
    print("created tunnel " + str(t.get("id")), file=sys.stderr)
tid = t["id"]
print("tunnel: " + t.get("name", "?") + " (" + tid + ")", file=sys.stderr)

cfg = api("GET", f"/accounts/{acct}/tunnels/{tid}/configurations").get("result") or {}
ing = (cfg.get("config") or {}).get("ingress") or []
ok = any(e.get("hostname") == HOSTNAME and e.get("service") == SERVICE for e in ing)
if not ok:
    new_ing = [{"hostname": HOSTNAME, "service": SERVICE}] + [e for e in ing if e.get("hostname")] + [{"service": "http_status:404"}]
    r = api("PUT", f"/accounts/{acct}/tunnels/{tid}/configurations", {"config": {"ingress": new_ing}})
    print("ingress updated: " + str(r.get("success")), file=sys.stderr)

zones = api("GET", "/zones?name=flauz.app").get("result") or []
if zones:
    zid = zones[0]["id"]
    recs = api("GET", f"/zones/{zid}/dns_records?name={HOSTNAME}&type=CNAME").get("result") or []
    content = tid + ".cfargotunnel.com"
    if not any(r.get("content") == content for r in recs):
        r = api("POST", f"/zones/{zid}/dns_records", {"type": "CNAME", "name": HOSTNAME, "content": content, "proxied": True})
        print("dns record created: " + str(r.get("success")), file=sys.stderr)
else:
    print("WARN: flauz.app zone not found in this CF account", file=sys.stderr)

tok = api("GET", f"/accounts/{acct}/tunnels/{tid}/token").get("result")
if not tok:
    print("FATAL: no tunnel token", file=sys.stderr); sys.exit(1)
print(tok)
