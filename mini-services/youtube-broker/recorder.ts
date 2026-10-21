/**
 * WFX2 P34 — WIRE-CAPTURE — the CDP network recorder.
 *
 * The house law (ledgered at P33): a direct action lane ships ONLY with a
 * CAPTURED wire template — never a guessed protobuf. The remaining
 * broker-tier actions (dislike, bell preferences, comment-like, the
 * feedback family, history writes) all fire their REAL InnerTube wires
 * inside the logged-in tab whenever the broker executes them — until now
 * those wires were dropped on the floor with every other CDP event. This
 * recorder keeps them, so the operator's next natural dislike/bell/
 * comment-like through WebFlix captures its own upgrade path: the wire
 * lands in captures.jsonl, the promotion tool walks it, the reviewed
 * fixture joins youtube-direct.ts, and the action joins the direct family.
 *
 * Mechanics: wraps ONE action execution window on an existing
 * CdpConnection — Network.enable before the action, endpoint-filtered
 * Network.requestWillBeSent / responseReceived / loadingFailed events
 * during, a Network.getRequestPostData fallback for bodies the event
 * didn't carry, Network.disable + journal append after. The recorder
 * NEVER fails the action it observes (every recorder error is swallowed
 * into fewer/no captures — the action result is the product; the capture
 * is the byproduct).
 */
import type { CdpConnection } from "./cdp";
import { CaptureEntry, CaptureJournal } from "./captures";
import type { BrokerTarget } from "./types";

/**
 * The youtubei ACTION families, by path prefix. Read noise (browse page
 * loads, player, next, watch, search…) is excluded by construction — only
 * the write-side endpoint families a broker action can fire are kept:
 *   like/         like / dislike / remove-rating
 *   subscription/ subscribe / unsubscribe (bell rides this family too —
 *                 captured wire will name its exact endpoint)
 *   notification/ bell preference + notifications-mark-read family
 *   comment/      create_comment / perform_comment_action (comment-like,
 *                 delete, heart, pin…)
 *   feedback      not-interested / dont-recommend-channel / undo
 *   browse/edit_playlist  playlist membership writes (add/remove/WW)
 *   history/      history-remove / pause / clear-all
 *   live_chat/    live-chat-send
 */
const ACTION_ENDPOINT_RE =
  /^\/youtubei\/v1\/(like\/|subscription\/|notification\/|comment\/|feedback|browse\/edit_playlist|history\/|live_chat\/)/;

const YOUTUBEI_PREFIX = "/youtubei/v1/";

/** Bodies above this are truncated (a youtubei action body is ~1–4 KiB;
 * anything larger is not an action wire worth keeping whole). */
export const MAX_POST_DATA = 65536;

/** The event shapes the recorder consumes (only the fields it reads). */
interface RequestWillBeSentParams {
  requestId?: string;
  request?: { url?: string; method?: string; postData?: string };
}
interface ResponseReceivedParams {
  requestId?: string;
  response?: { status?: number };
}
interface LoadingFailedParams {
  requestId?: string;
}

export class WireRecorder {
  private pending = new Map<string, CaptureEntry>();
  private offs: (() => void)[] = [];
  private started = false;

  constructor(
    private conn: CdpConnection,
    private journal: CaptureJournal,
    private context: { kind: string; target: BrokerTarget },
    private now: () => string = () => new Date().toISOString()
  ) {}

  /** Arm the recorder: subscribe events + enable the Network domain. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.offs.push(this.conn.on("Network.requestWillBeSent", (p) => this.onRequest(p)));
    this.offs.push(this.conn.on("Network.responseReceived", (p) => this.onResponse(p)));
    this.offs.push(this.conn.on("Network.loadingFailed", (p) => this.onFailed(p)));
    await this.conn.send("Network.enable", {});
  }

  /**
   * Close the window: fetch bodies the events didn't carry, unsubscribe,
   * disable the Network domain, append every captured wire to the journal.
   * Returns the number of captures appended. Safe to call exactly once,
   * after start(); never throws (the caller treats captures as a byproduct).
   */
  async flush(): Promise<number> {
    if (!this.started) return 0;
    this.offs.splice(0).forEach((off) => off());
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      if (entry.postData === null) {
        try {
          const r = (await this.conn.send(
            "Network.getRequestPostData",
            { requestId: entry.requestId },
            5000
          )) as { postData?: unknown } | undefined;
          if (typeof r?.postData === "string") {
            const { text, truncated } = capPostData(r.postData);
            entry.postData = text;
            entry.truncated = truncated;
          }
        } catch {
          /* the request's body is gone from the browser's cache — stays
             null, the honest shape */
        }
      }
    }
    try {
      await this.conn.send("Network.disable", {});
    } catch {
      /* the connection is closing anyway */
    }
    for (const entry of entries) {
      try {
        this.journal.append(entry);
      } catch {
        /* journal write failures never surface into the action result */
      }
    }
    return entries.length;
  }

  private onRequest(params: unknown): void {
    try {
      const p = params as RequestWillBeSentParams;
      const requestId = p.requestId;
      const req = p.request;
      if (!requestId || !req || typeof req.url !== "string") return;
      if (this.pending.has(requestId)) return; // redirect re-send: first wins
      let pathname: string;
      try {
        pathname = new URL(req.url).pathname;
      } catch {
        return;
      }
      if (!ACTION_ENDPOINT_RE.test(pathname)) return;
      if ((req.method ?? "").toUpperCase() !== "POST") return;
      const { text, truncated } =
        typeof req.postData === "string" ? capPostData(req.postData) : { text: null, truncated: false };
      this.pending.set(requestId, {
        ts: this.now(),
        kind: this.context.kind,
        target: this.context.target,
        endpoint: pathname.startsWith(YOUTUBEI_PREFIX)
          ? pathname.slice(YOUTUBEI_PREFIX.length)
          : pathname,
        url: req.url,
        method: req.method ?? "POST",
        postData: text,
        truncated,
        status: null,
        requestId,
      });
    } catch {
      /* recorder defects never break the channel */
    }
  }

  private onResponse(params: unknown): void {
    try {
      const p = params as ResponseReceivedParams;
      if (!p.requestId) return;
      const entry = this.pending.get(p.requestId);
      if (!entry) return;
      if (typeof p.response?.status === "number") entry.status = p.response.status;
    } catch {
      /* recorder defects never break the channel */
    }
  }

  private onFailed(params: unknown): void {
    try {
      const p = params as LoadingFailedParams;
      if (!p.requestId) return;
      const entry = this.pending.get(p.requestId);
      if (entry) entry.status = null; // honest: not observed
    } catch {
      /* recorder defects never break the channel */
    }
  }
}

function capPostData(raw: string): { text: string; truncated: boolean } {
  if (raw.length <= MAX_POST_DATA) return { text: raw, truncated: false };
  return { text: raw.slice(0, MAX_POST_DATA), truncated: true };
}
