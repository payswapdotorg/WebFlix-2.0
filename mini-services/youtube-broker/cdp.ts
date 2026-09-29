/**
 * WFX2-A-W Session Broker — minimal CDP client.
 *
 * Talks to the browser's DevTools endpoint (CDP_HTTP, default
 * http://127.0.0.1:9222): lists targets over HTTP, connects to a target's
 * webSocketDebuggerUrl, and does Runtime.evaluate / Page.navigate RPCs.
 * No external dependencies (Bun's native WebSocket).
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

/** One WebSocket connection to one debug target. */
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

  static async connect(wsUrl: string, timeoutMs = 5000): Promise<CdpConnection> {
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

  get isClosed(): boolean {
    return this.closed;
  }

  /** Send a CDP command; resolves with the result, rejects on error/timeout. */
  send(method: string, params: Record<string, unknown> = {}, timeoutMs = 30000): Promise<any> {
    if (this.closed) return Promise.reject(new Error("CDP connection closed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Evaluate an expression in the page. Returns the JSON value the expression
   * resolved to (returnByValue). Rejects on CDP-level errors; an expression
   * that itself throws resolves to { __exception: <message> }.
   */
  async evaluate(expression: string, timeoutMs = 30000): Promise<any> {
    const res = await this.send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      timeoutMs
    );
    if (res?.exceptionDetails) {
      const text = res.exceptionDetails.exception?.description ?? res.exceptionDetails.text;
      return { __exception: String(text).slice(0, 500) };
    }
    return res?.result?.value;
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
    this.closed = true;
  }
}

/** List page targets (GET {CDP_HTTP}/json). */
export async function listPages(cdpHttp: string, timeoutMs = 3000): Promise<CdpTargetInfo[]> {
  const res = await fetch(`${cdpHttp}/json`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`CDP /json returned ${res.status}`);
  const targets = (await res.json()) as CdpTargetInfo[];
  return targets.filter((t) => t.type === "page");
}

/** Create a new tab (PUT {CDP_HTTP}/json/new?url=…; older Chrome uses GET). */
export async function newTab(cdpHttp: string, url: string, timeoutMs = 5000): Promise<CdpTargetInfo> {
  const endpoint = `${cdpHttp}/json/new?${encodeURIComponent(url)}`;
  let res: Response | undefined;
  try {
    res = await fetch(endpoint, { method: "PUT", signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    res = undefined;
  }
  if (!res || !res.ok) {
    res = await fetch(endpoint, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
  }
  if (!res.ok) throw new Error(`CDP /json/new returned ${res.status}`);
  return (await res.json()) as CdpTargetInfo;
}

export interface YoutubeTab {
  target: CdpTargetInfo;
  /** true when this call created the tab (it starts cold — needs a load wait) */
  created: boolean;
}

/** Find a youtube.com tab, or create one on youtube.com. */
export async function ensureYoutubeTab(cdpHttp: string): Promise<YoutubeTab> {
  const pages = await listPages(cdpHttp);
  const existing = pages.find((t) => t.url.includes("youtube.com"));
  if (existing) return { target: existing, created: false };
  const target = await newTab(cdpHttp, "https://www.youtube.com/");
  return { target, created: true };
}

/**
 * Navigate the tab to `url` (if it isn't already there) and wait for the
 * document to reach readyState "interactive" or better. Navigation happens
 * via Page.navigate (a separate CDP step — in-page location.assign would
 * destroy the evaluation context).
 */
export async function navigateIfNeeded(
  conn: CdpConnection,
  url: string,
  opts: { timeoutMs?: number } = {}
): Promise<{ navigated: boolean; url: string }> {
  const timeoutMs = opts.timeoutMs ?? 20000;
  const current = await conn.evaluate("location.href", 5000).catch(() => null);
  if (typeof current === "string" && current.startsWith(url)) {
    return { navigated: false, url: current };
  }
  await conn.send("Page.navigate", { url }, 15000);
  const t0 = Date.now();
  for (;;) {
    const ready = await conn
      .evaluate(
        "document.readyState === 'complete' || document.readyState === 'interactive' ? 'ready' : document.readyState",
        5000
      )
      .catch(() => null);
    if (ready === "ready") break;
    if (Date.now() - t0 > timeoutMs) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  const finalUrl = await conn.evaluate("location.href", 5000).catch(() => null);
  return { navigated: true, url: typeof finalUrl === "string" ? finalUrl : url };
}
