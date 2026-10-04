/**
 * WFX2-A-W app-side broker client (Tier-2 WRITE proxy).
 *
 * Typed client for the Session Broker (mini-services/youtube-broker, port
 * 3055 on the lead sandbox). POSTs `${BROKER_URL}/broker/action` with the
 * shared-secret header; maps failures to typed errors the routes turn into
 * honest 502s ("action backend offline — the lead's broker must be running").
 *
 * Env (secrets from env ONLY):
 *   BROKER_URL      default http://127.0.0.1:3055 (direct local broker); or
 *                   a gateway base, optionally WITH query — e.g.
 *                   https://host/?XTransformPort=3055 — whose routing query
 *                   rides on every request (see brokerEndpoint)
 *   BROKER_QUERY    optional routing query for gateway bases, e.g.
 *                   XTransformPort=3055 — appended to EVERY broker request
 *                   (`?<BROKER_QUERY>`); composes safely with a plain base
 *                   and with a query already embedded in BROKER_URL
 *   BROKER_SECRET   shared secret (must match the broker's BROKER_SECRET)
 *   BROKER_TIMEOUT_MS  default 15000
 */

// the l2Active() law (upstash-cache.ts): a test upstream serving fixtures
// means NO live-network reads, broker included — .env carries BROKER_SECRET
// on this machine, so without this guard every walled-shape test
// (channel-wall, playback-fallback, cutover…) would hit the LIVE local broker
import { isTestUpstream } from "./youtube/upstream";

/** Dev default — the broker's own port on the lead sandbox (local runs
 *  work with just BROKER_SECRET set; production overrides via Vercel env). */
const DEFAULT_BROKER_URL = "http://127.0.0.1:3055";

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
  | "post-create"
  // WFX2-P3-UP (upload execution) — additive
  | "upload-execute"
  // WFX2-P3-LC (live chat send) — additive
  | "live-chat-send"
  // WFX2-4A (broker READ transport) — additive: a page-context fetch of a
  // youtube.com path in the logged-in tab (see brokerFetchPage)
  | "fetch";

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
  // WFX2-P3-UP (upload execution) — additive
  /** upload-execute: the staged file name attached to the real file input */
  fileName?: string;
  /** upload-execute: the staged file URL the operator tab fetches (the app's /api/upload/stage route) */
  fileUrl?: string;
  /** upload-execute: the description the drive fills into the Details step */
  description?: string;
  /** WFX2-P3-LC: live-chat-send message text */
  message?: string;
  /**
   * WFX2-4A: fetch — the youtube.com PATH to read (must start with "/";
   * absolute URLs and other hosts are refused by the broker's validation).
   * The wire contract carries it TOP-LEVEL ({kind:"fetch", path:"/…"}) —
   * see brokerFetchPage; the payload form is the tolerated alias.
   */
  path?: string;
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
  return url ? url.replace(/\/+$/, "") : DEFAULT_BROKER_URL;
}

/**
 * The optional gateway routing query (BROKER_QUERY, e.g. "XTransformPort=3055")
 * that must ride on EVERY request when the broker sits behind the sandbox's
 * public gateway. A leading "?"/"&" is tolerated and stripped (the env holds
 * a query STRING, not a delimiter).
 */
export function brokerQuery(): string {
  return (process.env.BROKER_QUERY ?? "").trim().replace(/^[?&]+/, "");
}

/**
 * Compose the full endpoint for a broker `path` (e.g. "/broker/action").
 * Gateway routing queries ride on every request, from either source:
 * embedded in BROKER_URL (`https://host/?XTransformPort=3055`) or the separate
 * BROKER_QUERY env — composed safely (single "?", "&"-joined, no doubled
 * slashes): `https://host` + `/broker/action` + `XTransformPort=3055` →
 * `https://host/broker/action?XTransformPort=3055`. Plain bases compose
 * unchanged (`http://127.0.0.1:3055/broker/action`).
 */
export function brokerEndpoint(path: string): string {
  const url = brokerUrl();
  const q = url.indexOf("?");
  const base = (q === -1 ? url : url.slice(0, q)).replace(/\/+$/, "");
  const safePath = path.startsWith("/") ? path : `/${path}`;
  const query = [q === -1 ? "" : url.slice(q + 1), brokerQuery()]
    .filter(Boolean)
    .join("&");
  return `${base}${safePath}${query ? `?${query}` : ""}`;
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
    res = await fetch(brokerEndpoint("/broker/action"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-broker-secret": brokerSecret(),
        // the sandbox's public gateway enforces session affinity on every
        // request — any stable id passes; direct brokers ignore the header
        "x-session-id": "webflix-producer",
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

// ---------------------------------------------------------------------------
// WFX2-P3-UP — upload execution (additive; the P2-SO helper pattern)
// ---------------------------------------------------------------------------

/** The upload-execute success shape (the staged drive's honest result). */
export interface BrokerUploadExecuteSuccess extends BrokerActionSuccess {
  ok: true;
  detail?: {
    stage?:
      | "navigating"
      | "dialog"
      | "details"
      | "checks"
      | "visibility"
      | "uploading"
      | "processing"
      | "published"
      | (string & {});
    videoId?: string;
    watchUrl?: string;
    note?: string;
  } & Record<string, unknown>;
  /** the UNVERIFIED publish's honest note rides TOP-LEVEL on the wire (the
   *  script's return shape), not inside detail */
  note?: string;
}

export interface BrokerUploadExecuteInput {
  /** the staged file URL the operator tab fetches (the app's staging route) */
  fileUrl: string;
  /** the File name the drive attaches to the real file input */
  fileName: string;
  title: string;
  description?: string;
  visibility: "public" | "unlisted" | "private";
}

/** How long the app waits on the broker's staged drive — the script's own
 * ceiling is 300000ms; the margin covers broker-side dispatch + retries. */
export const UPLOAD_EXECUTE_TIMEOUT_MS = 310_000;

/** Gap between re-invokes when the script reports the honest 'navigating'
 * intermediate (the tab is landing on the upload page — consumed by the
 * src/lib/upload/drive loop, NOT this single-shot helper). */
export const UPLOAD_NAVIGATE_RETRY_MS = 2000;

/**
 * WFX2-P3-UP — Tier-2 broker WRITE: ONE staged-drive invocation. The REAL
 * youtube.com upload flow (file input → metadata → Next×3 → visibility →
 * publish) runs in the logged-in operator tab with the staged file bytes.
 * Self-contained POST (the P2-SO brokerCommunityRead pattern, video-scaled):
 * the staged drive legitimately outlives the default broker timeout, so this
 * helper carries its own fetch + typed error mapping instead of changing
 * brokerAction's contract.
 *
 * A single evaluate cannot survive the script's own navigation, so the first
 * invocation may honestly report {detail:{stage:'navigating'}} — the
 * navigate→re-invoke ladder lives in src/lib/upload/drive.ts (the flow
 * layer). Fails typed (offline / unauthorized / bad-request /
 * action-failed) — never a synthesized success.
 */
export async function brokerUploadExecute(
  input: BrokerUploadExecuteInput
): Promise<BrokerUploadExecuteSuccess | BrokerError> {
  const url = brokerUrl();
  if (!url || !brokerSecret()) {
    return new BrokerError("offline", BROKER_OFFLINE_MESSAGE, 502);
  }
  let res: Response;
  try {
    res = await fetch(brokerEndpoint("/broker/action"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-broker-secret": brokerSecret(),
        // session affinity for the sandbox's public gateway (see brokerAction)
        "x-session-id": "webflix-producer",
      },
      body: JSON.stringify({
        kind: "upload-execute",
        target: {},
        payload: {
          fileUrl: input.fileUrl,
          fileName: input.fileName,
          title: input.title,
          ...(input.description ? { description: input.description } : {}),
          visibility: input.visibility,
        },
      }),
      signal: AbortSignal.timeout(UPLOAD_EXECUTE_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new BrokerError("offline", BROKER_OFFLINE_MESSAGE, 502, msg);
  }

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    /* non-JSON body */
  }

  if (res.status === 401) {
    return new BrokerError("unauthorized", "broker rejected the shared secret", 502, parsed);
  }
  if (res.status === 400) {
    const message =
      (parsed as { error?: string } | null)?.error ?? "broker rejected the action request";
    return new BrokerError("bad-request", message, 400, parsed);
  }
  if (!res.ok) {
    // the WHOLE 502 body rides as detail: the staged drive nests its honest
    // stage in body.detail.stage AND its observed DOM in body.dom — the
    // brokerAction house pattern (detail = dom-only) would drop the stage
    // the /api/upload/execute route surfaces in the error card
    const r = parsed as { error?: string } | null;
    return new BrokerError("action-failed", r?.error ?? "broker action failed", 502, parsed);
  }
  return (parsed ?? { ok: true }) as BrokerUploadExecuteSuccess;
}

// ---------------------------------------------------------------------------
// WFX2-4A — broker READ: the page-context fetch transport (additive)
// ---------------------------------------------------------------------------

/**
 * The fetch success shape (the broker's own wire contract): the TRANSPORT
 * succeeded — `status` is the fetched page's own HTTP status (carried, not
 * judged; a 4xx page is the caller's to interpret), `body` the page HTML
 * capped at the broker's 4 MiB limit.
 */
export interface BrokerFetchSuccess {
  ok: true;
  /** the page-context fetch's HTTP status (2xx/3xx/4xx/5xx — carried) */
  status: number;
  /** the fetched page HTML (capped at 4 MiB — see truncated) */
  body: string;
  /** the body hit the 4 MiB cap and was truncated (channel HTML runs 1–3 MiB) */
  truncated?: boolean;
}

/** How long the app waits on one broker page read — the broker's own script
 * ceiling is 45s (the page-context fetch + a 1–3 MiB read); this budget
 * covers dispatch + retries under it. */
export const BROKER_FETCH_TIMEOUT_MS = 30_000;

/**
 * WFX2-4A — Tier-2 broker READ: one youtube.com page fetched in the
 * LOGGED-IN tab's page context (credentials included) and returned as HTML.
 * Wire shape {kind:"fetch", path:"/…"} — the path rides TOP-LEVEL, not in a
 * payload (the broker-side contract; the shared tab is NEVER navigated, so
 * reads never disturb the operator view).
 *
 * Self-contained POST (the brokerUploadExecute pattern) with its own ~30s
 * timeout and the sibling typed error mapping (offline / unauthorized /
 * bad-request / action-failed) — never a synthesized page.
 *
 * TEST-UPSTREAM GUARD (the l2Active() law): while a test upstream serves
 * fixtures (setUpstream), this helper answers the honest offline error
 * WITHOUT any fetch — see the isTestUpstream import above.
 */
export async function brokerFetchPage(path: string): Promise<BrokerFetchSuccess | BrokerError> {
  if (isTestUpstream()) {
    return new BrokerError("offline", BROKER_OFFLINE_MESSAGE, 502, "test-upstream");
  }
  const url = brokerUrl();
  if (!url || !brokerSecret()) {
    return new BrokerError("offline", BROKER_OFFLINE_MESSAGE, 502);
  }
  let res: Response;
  try {
    res = await fetch(brokerEndpoint("/broker/action"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-broker-secret": brokerSecret(),
        // session affinity for the sandbox's public gateway (see brokerAction)
        "x-session-id": "webflix-producer",
      },
      body: JSON.stringify({ kind: "fetch", path }),
      signal: AbortSignal.timeout(BROKER_FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new BrokerError("offline", BROKER_OFFLINE_MESSAGE, 502, msg);
  }

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    /* non-JSON body */
  }

  if (res.status === 401) {
    return new BrokerError("unauthorized", "broker rejected the shared secret", 502, parsed);
  }
  if (res.status === 400) {
    const message =
      (parsed as { error?: string } | null)?.error ?? "broker rejected the action request";
    return new BrokerError("bad-request", message, 400, parsed);
  }
  if (!res.ok) {
    const r = parsed as { error?: string } | null;
    return new BrokerError("action-failed", r?.error ?? "broker action failed", 502, parsed);
  }
  return (parsed ?? { ok: true, status: 0, body: "" }) as BrokerFetchSuccess;
}

/** The live-chat-send success shape (detail.messageId when the broker
 * re-read the message from the chat stream). */
export interface BrokerLiveChatSendSuccess extends BrokerActionSuccess {
  ok: true;
  detail?:
    | ({ messageId?: string | null; author?: string | null; note?: string } & Record<
        string,
        unknown
      >)
    | undefined;
}

/**
 * WFX2-P3-LC — Tier-2 broker WRITE: send a live-chat message by typing it
 * into the REAL live-chat composer in the logged-in tab (the watch page of
 * `videoId`; the broker presses Enter and verifies the message landed in
 * the stream). Fails typed (offline / action-failed) — the honest error
 * strings are the executor's taxonomy: chat-members-only, chat-slow-mode,
 * chat-disabled, live-chat-composer-not-found, live-chat-send-failed.
 */
export async function brokerLiveChatSend(
  videoId: string,
  message: string
): Promise<BrokerLiveChatSendSuccess | BrokerError> {
  return brokerAction("live-chat-send", { videoId }, { message });
}
