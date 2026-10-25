/**
 * WebFlix Netflix Desktop — minimal CDP client (E2B tunnel flavor).
 *
 * Chrome inside the E2B sandbox listens on 127.0.0.1:9222 with a Host-header
 * check that rejects proxied hostnames. A tiny python relay (cdp-relay.py,
 * port 9223) rewrites `Host:` to `127.0.0.1:9222`; this client speaks HTTP +
 * WebSocket through the sandbox's public host (9223-<id>.e2b.app).
 * No external dependencies (Bun's native WebSocket + fetch).
 */

export interface CdpTargetInfo {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl: string;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CdpConnection {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev: MessageEvent) => {
      let msg: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.id === undefined) return;
      const call = this.pending.get(msg.id);
      if (!call) return;
      clearTimeout(call.timer);
      this.pending.delete(msg.id);
      if (msg.error) call.reject(new Error(`CDP error: ${msg.error.message ?? "unknown"}`));
      else call.resolve(msg.result);
    });
    ws.addEventListener("close", () => {
      this.closed = true;
      for (const call of this.pending.values()) {
        clearTimeout(call.timer);
        call.reject(new Error("CDP connection closed"));
      }
      this.pending.clear();
    });
  }

  static async connect(wsUrl: string, timeoutMs = 8000): Promise<CdpConnection> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP connect timeout")), timeoutMs);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("CDP connect failed"));
      });
    });
    return new CdpConnection(ws);
  }

  get isOpen() {
    return !this.closed;
  }

  async send<T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs = 15000): Promise<T> {
    if (this.closed) throw new Error("CDP connection closed");
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params: params ?? {} });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        timer,
      });
      this.ws.send(payload);
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* noop */
    }
  }
}

/** Public sandbox host for a given internal port (e2b proxy pattern). */
export function sandboxHost(sandboxId: string, port: number, domain = "e2b.app"): string {
  return `${port}-${sandboxId}.${domain}`;
}

/**
 * Connect to the Chrome page target inside the sandbox through the relay.
 *
 * P51-AUDIT (B2): the relay demands the per-boot `relayToken` (the sandbox's
 * public CDP port is otherwise a takeover path) — carried on BOTH legs: the
 * /json/list fetch (query + header) and the WS upgrade (query; the relay
 * strips it before Chrome sees the request).
 */
export async function connectChromePage(
  sandboxId: string,
  opts: { domain?: string; preferUrlIncludes?: string; relayToken?: string } = {},
): Promise<CdpConnection> {
  const domain = opts.domain ?? "e2b.app";
  const host = sandboxHost(sandboxId, 9223, domain);
  const token = opts.relayToken ?? "";
  if (!token) throw new Error("cdp relay token missing (refusing an unauthenticated relay)");
  const tokenQuery = `token=${encodeURIComponent(token)}`;
  const tokenHeaders = { "x-nf-relay-token": token } as Record<string, string>;
  // list targets (retry until chrome's debug port is accepting)
  let targets: CdpTargetInfo[] = [];
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`https://${host}/json/list?${tokenQuery}`, {
        headers: tokenHeaders,
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        targets = (await res.json()) as CdpTargetInfo[];
        break;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const pages = targets.filter((t) => t.type === "page");
  const chosen =
    (opts.preferUrlIncludes ? pages.find((t) => t.url.includes(opts.preferUrlIncludes!)) : undefined) ?? pages[0];
  if (!chosen) throw new Error("no chrome page target found");
  // rewrite ws(s)://<anything>/path → wss://<public host>/path (+ relay token)
  const u = new URL(chosen.webSocketDebuggerUrl);
  const existing = u.search ? `${u.search}&${tokenQuery}` : `?${tokenQuery}`;
  const wsUrl = `wss://${host}${u.pathname}${existing}`;
  return CdpConnection.connect(wsUrl);
}
