/**
 * WebFlix Netflix Desktop — residential egress for the cloud Chrome (P46).
 *
 * WHY: the one auth question P45 could not answer until a real cookie exists
 * is the home→E2B IP transfer — Netflix may distrust a session cookie that
 * mints in a home browser and then spends its life on a datacenter IP. The
 * mitigation: route the sandbox Chrome's netflix.com traffic through the
 * operator's Apify residential proxy (session-sticky → one stable household
 * IP for the sandbox lifetime), so the cloud session looks like the same
 * household device that minted the cookies.
 *
 * MEASURED (2026-10-26): proxy.apify.com auth from OUTSIDE an actor needs the
 * dedicated APIFY_PROXY_PASSWORD (Console → Integrations) — the APIFY_TOKEN
 * alone answers 407 (groups-BUYPROXIES94952 / groups-RESIDENTIAL / auto all
 * probed). So this path is env-gated and FAILS OPEN to direct egress:
 *   NETFLIX_EGRESS=direct|auto   (auto = residential when APIFY_PROXY_PASSWORD is set)
 *   APIFY_PROXY_PASSWORD=…      (the 32-char proxy password, not the token)
 *   APIFY_PROXY_GROUP=BUYPROXIES94952   APIFY_PROXY_COUNTRY=US (optional)
 *   APIFY_PROXY_SESSION=webflix-desktop (sticky session id, optional)
 */

export interface EgressPlan {
  mode: "direct" | "apify-residential";
  /** populated only when mode = apify-residential */
  upstream?: { host: string; port: number; username: string; password: string };
  /** the extra chrome flags when the forwarder is active */
  chromeFlags: string[];
  localProxy: string | null;
}

const LOCAL_PROXY_PORT = 31280;

export function buildEgressPlan(
  env: NodeJS.ProcessEnv = process.env,
): EgressPlan {
  const wantResidential =
    (env.NETFLIX_EGRESS ?? "auto") !== "direct" && !!env.APIFY_PROXY_PASSWORD;
  if (!wantResidential) {
    return { mode: "direct", chromeFlags: [], localProxy: null };
  }
  const proxyPassword = env.APIFY_PROXY_PASSWORD ?? "";
  const parts = [`groups-${env.APIFY_PROXY_GROUP ?? "BUYPROXIES94952"}`];
  if (env.APIFY_PROXY_SESSION) parts.push(`session-${env.APIFY_PROXY_SESSION}`);
  if (env.APIFY_PROXY_COUNTRY) parts.push(`country-${env.APIFY_PROXY_COUNTRY}`);
  return {
    mode: "apify-residential",
    upstream: {
      host: "proxy.apify.com",
      port: 8000,
      username: parts.join(","),
      password: proxyPassword,
    },
    chromeFlags: [`--proxy-server=http://127.0.0.1:${LOCAL_PROXY_PORT}`],
    localProxy: `http://127.0.0.1:${LOCAL_PROXY_PORT}`,
  };
}

/**
 * A dependency-free CONNECT forwarder (python stdlib only): the sandbox
 * Chrome speaks plain proxy to 127.0.0.1:31280; the forwarder re-dials the
 * authenticated Apify upstream per connection. netflix.com is https-only, so
 * CONNECT tunnels cover the whole session.
 */
export const EGRESS_FORWARDER_PY = String.raw`#!/usr/bin/env python3
"""WebFlix egress forwarder: local CONNECT proxy -> authenticated upstream."""
import base64, os, select, socket, sys

UPSTREAM = (os.environ["EGRESS_UPSTREAM_HOST"], int(os.environ["EGRESS_UPSTREAM_PORT"]))
AUTH = base64.b64encode(
    f"{os.environ['EGRESS_UPSTREAM_USER']}:{os.environ['EGRESS_UPSTREAM_PASS']}".encode()
).decode()
LOCAL = ("127.0.0.1", int(os.environ.get("EGRESS_LOCAL_PORT", "31280")))

def pipe(a: socket.socket, b: socket.socket) -> None:
    try:
        while True:
            r, _, _ = select.select([a, b], [], [], 60)
            if not r:
                break
            for s in r:
                data = s.recv(65536)
                if not data:
                    return
                (b if s is a else a).sendall(data)
    except OSError:
        pass
    finally:
        try: a.close()
        except OSError: pass
        try: b.close()
        except OSError: pass

def handle(conn: socket.socket) -> None:
    try:
        conn.settimeout(30)
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = conn.recv(65536)
            if not chunk:
                return
            head += chunk
        line = head.split(b"\r\n", 1)[0].decode("latin1")
        parts = line.split(" ")
        if len(parts) < 2 or not parts[1].startswith("http"):
            conn.sendall(b"HTTP/1.1 400 Bad Request\r\n\r\n")
            return
        target = parts[1].split("://", 1)[1].split("/", 1)[0]
        up = socket.create_connection(UPSTREAM, timeout=30)
        up.sendall(
            f"CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n"
            f"Proxy-Authorization: Basic {AUTH}\r\n\r\n".encode()
        )
        resp = b""
        up.settimeout(30)
        while b"\r\n\r\n" not in resp:
            chunk = up.recv(65536)
            if not chunk:
                return
            resp += chunk
        status = resp.split(b" ", 2)[1] if b" " in resp else b"502"
        conn.sendall(
            f"HTTP/1.1 {status.decode('latin1')} Connected\r\n\r\n".encode("latin1")
            if status == b"200"
            else b"HTTP/1.1 502 Bad Gateway\r\n\r\n"
        )
        if status != b"200":
            return
        leftover = head.split(b"\r\n\r\n", 1)[1]
        if leftover:
            up.sendall(leftover)
        conn.settimeout(None)
        up.settimeout(None)
        pipe(conn, up)
    except OSError:
        pass
    finally:
        try: conn.close()
        except OSError: pass

def main() -> None:
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(LOCAL)
    srv.listen(24)
    print(f"[egress] forwarder on {LOCAL[0]}:{LOCAL[1]} -> {UPSTREAM[0]}:{UPSTREAM[1]}", flush=True)
    while True:
        conn, _ = srv.accept()
        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        import threading
        threading.Thread(target=handle, args=(conn,), daemon=True).start()

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
`;

/** The sandbox commands to (a) write the forwarder, (b) run it, (c) health-check it. */
export function egressBootstrap(plan: EgressPlan): { script: string; healthCheck: string } | null {
  if (plan.mode !== "apify-residential" || !plan.upstream) return null;
  const envs =
    `EGRESS_UPSTREAM_HOST=${plan.upstream.host} EGRESS_UPSTREAM_PORT=${plan.upstream.port} ` +
    `EGRESS_UPSTREAM_USER='${plan.upstream.username}' EGRESS_UPSTREAM_PASS='${plan.upstream.password}' ` +
    `EGRESS_LOCAL_PORT=${LOCAL_PROXY_PORT} `;
  return {
    script:
      `pkill -f cdp-egress-forwarder.py >/dev/null 2>&1 || true; ` +
      `cat > /home/user/cdp-egress-forwarder.py <<'EGRESSPY'\n${EGRESS_FORWARDER_PY}EGRESSPY\n` +
      `${envs}setsid nohup python3 /home/user/cdp-egress-forwarder.py >/tmp/egress.log 2>&1 < /dev/null & ` +
      `echo EGRESS_STARTED`,
    healthCheck: `for i in 1 2 3; do ` +
      `curl -s --max-time 20 -x http://127.0.0.1:${LOCAL_PROXY_PORT} https://api.ipify.org && break || sleep 3; done`,
  };
}
