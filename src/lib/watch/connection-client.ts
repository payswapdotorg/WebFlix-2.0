/**
 * WFX2 Task 4-b — the YouTube connection client (browser side).
 *
 * WebFlix performs YouTube write actions (like, subscribe, comment) through
 * one shared logged-in session — the broker's operator tab. The connection
 * state comes from GET /api/connection/youtube (the server-side proxy that
 * talks to the broker; the broker URL and shared secret never reach the
 * browser).
 *
 * This module owns the client side of that surface:
 *  - the typed state + an SWR-style ~30s cache (one probe per TTL window no
 *    matter how many surfaces ask; `force` re-probes for the Retry button)
 *  - isBrokerOfflineError — recognize the API's broker-offline error shape
 *  - toastActionError — the write-action error surfacing: the offline kind
 *    gets the "check the connection in Settings" toast with a Settings
 *    action; every other error keeps its existing per-surface message
 */
import { toast } from "sonner";

export interface YouTubeConnectionState {
  /** the broker answered healthy AND holds the YouTube tab — write actions work */
  connected: boolean;
  /** the broker's operator tab is on youtube.com right now */
  tabFound: boolean;
  /** the operator tab's current URL (coarse context; null when unknown) */
  tabUrl: string | null;
  /** when the session last performed an action (epoch ms / epoch s / ISO —
   * the broker's wire format; null when never or unknown) */
  lastActionAt: string | number | null;
  /** when the server performed this check (ISO) */
  checkedAt: string;
}

/** The toast copy for the broker-offline failure shape (Task 4-b). */
export const ACTIONS_DISCONNECTED_MESSAGE =
  "YouTube actions are disconnected — check the connection in Settings";

/** The settings anchor the offline toast's action opens. */
export const YOUTUBE_CONNECTION_SETTINGS_HREF = "/settings#youtube-connection";

/** How long a connection answer stays fresh (the SWR-style TTL). */
export const CONNECTION_TTL_MS = 30_000;

function disconnectedState(): YouTubeConnectionState {
  return {
    connected: false,
    tabFound: false,
    tabUrl: null,
    lastActionAt: null,
    checkedAt: new Date().toISOString(),
  };
}

/** Narrow whatever /api/connection/youtube answered into the typed state —
 * a missing/garbled field degrades to its falsy shape, never a throw. */
function normalizeState(body: unknown): YouTubeConnectionState {
  if (typeof body !== "object" || body === null) return disconnectedState();
  const b = body as Record<string, unknown>;
  const tabFound = b.tabFound === true;
  const tabUrl = typeof b.tabUrl === "string" && b.tabUrl ? b.tabUrl : null;
  const lastActionAt =
    typeof b.lastActionAt === "number" && Number.isFinite(b.lastActionAt)
      ? b.lastActionAt
      : typeof b.lastActionAt === "string" && b.lastActionAt
        ? b.lastActionAt
        : null;
  const checkedAt =
    typeof b.checkedAt === "string" && b.checkedAt ? b.checkedAt : new Date().toISOString();
  return { connected: b.connected === true && tabFound, tabFound, tabUrl, lastActionAt, checkedAt };
}

let cache: { state: YouTubeConnectionState; at: number } | null = null;
let inflight: Promise<YouTubeConnectionState> | null = null;

/**
 * Fetch the YouTube connection state through the ~30s cache. `force`
 * re-probes (the settings card's Retry button); concurrent callers share one
 * probe. NEVER rejects — an unreachable route or bad payload is the honest
 * disconnected state, cached like any other answer.
 */
export async function fetchYouTubeConnection(
  options?: { force?: boolean }
): Promise<YouTubeConnectionState> {
  if (!options?.force && cache && Date.now() - cache.at < CONNECTION_TTL_MS) {
    return cache.state;
  }
  if (inflight) return inflight;
  const probe = (async () => {
    let state: YouTubeConnectionState;
    try {
      const res = await fetch("/api/connection/youtube", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state = normalizeState(await res.json().catch(() => null));
    } catch {
      state = disconnectedState();
    }
    cache = { state, at: Date.now() };
    return state;
  })();
  inflight = probe;
  try {
    return await probe;
  } finally {
    if (inflight === probe) inflight = null;
  }
}

/** Drop the SWR cache — the test isolation hook for the surfaces battery. */
export function resetYouTubeConnectionCache(): void {
  cache = null;
  inflight = null;
}

/** The offline marker every broker-offline error message carries (the typed
 * offline kind in src/lib/broker.ts, incl. the comments tier's "…and the
 * WebFlix store is unreachable" variant). */
const BROKER_OFFLINE_MARKER = "action backend offline";

/**
 * Recognize the broker-offline failure shape: the write routes surface the
 * broker's typed offline kind as a 502 whose error string the API client
 * re-throws verbatim — message-shape matching (not instanceof), because the
 * client throws plain ApiClientErrors carrying the route's error string.
 */
export function isBrokerOfflineError(e: unknown): boolean {
  return e instanceof Error && e.message.toLowerCase().includes(BROKER_OFFLINE_MARKER);
}

/**
 * The write-action error toast (Task 4-b) — extends the existing sonner
 * surfacing, rebuilds nothing. The broker-offline shape becomes the
 * connection prompt (title + a Settings action that opens the YouTube
 * connection card); any other error keeps its existing per-surface message.
 */
export function toastActionError(e: unknown, fallback: string): void {
  if (isBrokerOfflineError(e)) {
    toast.error(ACTIONS_DISCONNECTED_MESSAGE, {
      description: "Like, subscribe and comment actions are unavailable right now.",
      action: {
        label: "Settings",
        onClick: () => window.location.assign(YOUTUBE_CONNECTION_SETTINGS_HREF),
      },
    });
    return;
  }
  toast.error(e instanceof Error ? e.message : fallback);
}

/**
 * Parse the broker's lastActionAt (epoch ms, epoch seconds, or ISO string)
 * into a Date — null when absent or unparseable (defensive: the broker's
 * wire format for the field is not pinned).
 */
export function parseConnectionTimestamp(value: string | number | null): Date | null {
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return new Date(value > 1e12 ? value : value * 1000);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return new Date(asNumber > 1e12 ? asNumber : asNumber * 1000);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
