/**
 * WFX2-A-W app-side broker client (Tier-2 WRITE proxy).
 *
 * Typed client for the Session Broker (mini-services/youtube-broker, port
 * 3055 on the lead sandbox). POSTs `${BROKER_URL}/broker/action` with the
 * shared-secret header; maps failures to typed errors the routes turn into
 * honest 502s ("action backend offline — the lead's broker must be running").
 *
 * Env (secrets from env ONLY):
 *   BROKER_URL      e.g. http://127.0.0.1:3055 (the lead's gateway forwards)
 *   BROKER_SECRET   shared secret (must match the broker's BROKER_SECRET)
 *   BROKER_TIMEOUT_MS  default 15000
 */

export const BROKER_OFFLINE_MESSAGE =
  "action backend offline — the lead's broker must be running";

export type BrokerKind =
  | "like"
  | "dislike"
  | "remove-rating"
  | "subscribe"
  | "unsubscribe"
  | "bell"
  | "comment-create"
  | "comment-reply"
  | "comment-like"
  | "playlist-add"
  | "watch-later"
  | "not-interested"
  // WFX2-B-B (personal surfaces) — additive
  | "history-remove"
  | "history-clear-all"
  | "history-pause"
  | "search-history-pause"
  | "playlist-remove-item"
  | "playlist-create"
  | "playlist-delete"
  | "notifications-mark-read"
  // WFX2-B-S (comment writes) — additive
  | "comment-edit"
  | "comment-delete"
  | "comment-heart"
  | "comment-pin"
  | "comment-report"
  // WFX2-P2-SO (community posts) — additive
  | "community-read"
  | "post-like"
  | "post-comment-create"
  | "post-comment-like"
  | "post-create";

export interface BrokerTarget {
  videoId?: string;
  channelId?: string;
  commentId?: string;
  playlistId?: string;
  /** WFX2-P2-SO: the community post the action applies to */
  postId?: string;
}

export interface BrokerPayload {
  text?: string;
  pref?: string;
  mode?: string;
  commentText?: string;
  title?: string;
  add?: boolean;
  videoId?: string;
  /** playlist-create: "private" | "unlisted" | "public" */
  visibility?: string;
  /** history-pause / search-history-pause: desired end state */
  paused?: boolean;
  /** comment-report: YouTube report-dialog reason label (substring match) */
  reason?: string;
  // WFX2-P2-SO (community posts) — additive
  /** community-read: the @handle whose community tab the browser reads */
  handle?: string;
  /** post-like: "like" | "dislike" | "remove" (desired end state) */
  action?: string;
  /** post-create: image attachment URL (fetched into the real composer) */
  imageUrl?: string;
  /** post-create: poll option texts (2-5) */
  pollOptions?: string[];
}

/** Typed failure for the routes to map (502 offline / 502 action-failed). */
export class BrokerError extends Error {
  kind: "offline" | "action-failed" | "unauthorized" | "bad-request";
  status: number;
  detail?: unknown;

  constructor(kind: BrokerError["kind"], message: string, status: number, detail?: unknown) {
    super(message);
    this.name = "BrokerError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

export interface BrokerActionSuccess {
  ok: true;
  /** the effect was re-read from the DOM after acting */
  verified?: boolean;
  /** desired state already held — nothing was clicked */
  already?: boolean;
  /** "ui" (DOM click) | "fetch" (page-context InnerTube) | "none" */
  path?: "ui" | "fetch" | "none";
  detail?: Record<string, unknown>;
}

export function brokerUrl(): string {
  const url = process.env.BROKER_URL?.trim();
  return url ? url.replace(/\/+$/, "") : "";
}

export function brokerSecret(): string {
  return process.env.BROKER_SECRET?.trim() ?? "";
}

export function brokerConfigured(): boolean {
  return brokerUrl() !== "" && brokerSecret() !== "";
}

export function brokerTimeoutMs(): number {
  const n = Number(process.env.BROKER_TIMEOUT_MS ?? 15000);
  return Number.isFinite(n) && n > 0 ? n : 15000;
}

/**
 * Execute one broker action. Never throws for broker-side failures —
 * returns a typed BrokerError for the caller to map. Network-level
 * unreachable/timeout → kind "offline" (the routes answer 502 with the
 * honest offline message).
 */
export async function brokerAction(
  kind: BrokerKind,
  target: BrokerTarget,
  payload?: BrokerPayload
): Promise<BrokerActionSuccess | BrokerError> {
  const url = brokerUrl();
  if (!url || !brokerSecret()) {
    return new BrokerError("offline", BROKER_OFFLINE_MESSAGE, 502);
  }
  let res: Response;
  try {
    res = await fetch(`${url}/broker/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-broker-secret": brokerSecret(),
      },
      body: JSON.stringify({ kind, target, ...(payload ? { payload } : {}) }),
      signal: AbortSignal.timeout(brokerTimeoutMs()),
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new BrokerError("offline", BROKER_OFFLINE_MESSAGE, 502, msg);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }

  if (res.status === 401) {
    return new BrokerError("unauthorized", "broker rejected the shared secret", 502, body);
  }
  if (res.status === 400) {
    const message =
      (body as { error?: string } | null)?.error ?? "broker rejected the action request";
    return new BrokerError("bad-request", message, 400, body);
  }
  if (!res.ok) {
    const r = body as { error?: string; dom?: unknown } | null;
    return new BrokerError(
      "action-failed",
      r?.error ?? "broker action failed",
      502,
      r?.dom ?? body
    );
  }
  return (body ?? { ok: true }) as BrokerActionSuccess;
}

/** Narrow a broker result to a success object (null when it's an error). */
export function brokerOk(
  result: BrokerActionSuccess | BrokerError
): (BrokerActionSuccess & { ok: true }) | null {
  if (result instanceof BrokerError) return null;
  return { ...(result as BrokerActionSuccess), ok: true as const };
}

/** The community-read success shape (the browser's own payload in detail.data). */
export interface BrokerCommunityReadSuccess extends BrokerActionSuccess {
  ok: true;
  detail?: { data?: unknown; url?: string; postsFound?: number } & Record<string, unknown>;
}

/**
 * WFX2-P2-SO — Tier-2 broker READ: the logged-in browser's own
 * youtube.com/@handle/community payload (window.ytInitialData), returned raw
 * for the app-side mapper (one mapper, two transports). Fails typed (offline
 * / action-failed) — never a synthesized payload.
 */
export async function brokerCommunityRead(
  handle: string,
  channelId?: string
): Promise<BrokerCommunityReadSuccess | BrokerError> {
  const result = await brokerAction(
    "community-read",
    { ...(channelId ? { channelId } : {}) },
    { handle }
  );
  if (result instanceof BrokerError) return result;
  return result as BrokerCommunityReadSuccess;
}
