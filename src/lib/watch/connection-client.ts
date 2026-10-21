/**
 * WFX2-P36-ACTION-PERSISTENCE — the YouTube connection client (browser side).
 *
 * P36: the connection truth is PER-USER OAuth. GET /api/connection/youtube
 * answers the new envelope — status connected | needs-reauth | not-connected |
 * not-configured, the connected account, the honest actions capability map
 * (official | local | unsupported), and the OAuth wiring (connect /
 * disconnect URLs, the redirect URI to register, the exact missing env
 * vars). The pre-P33/P35 truths (mode "direct"/"broker", the deployment-wide
 * operator session, the shared browser tab) are RETIRED — no surface may
 * render them again.
 *
 * This module owns the client side of that surface:
 *  - the typed state + an SWR-style ~30s cache (one probe per TTL window no
 *    matter how many surfaces ask; `force` re-probes for the card's Recheck)
 *  - toastActionError — the write-action error surfacing: a failure body
 *    {error, kind} with the P36 kinds youtube-not-connected /
 *    youtube-needs-reauth renders the connect / re-connect prompt (message +
 *    a Settings action); every other failure keeps its honest per-surface
 *    message
 */
import { toast } from "sonner";
import { ApiClientError } from "./client";

/** P36 — the per-user connection status (the route's own enum). */
export type YouTubeConnectionStatus =
  | "connected"
  | "needs-reauth"
  | "not-connected"
  | "not-configured";

/** The connected account (the route's account block; null when absent). */
export interface YouTubeConnectionAccount {
  channelId: string | null;
  channelTitle: string | null;
  channelThumbUrl: string | null;
  scope: string | null;
  /** ISO — when the user connected the account */
  connectedAt: string | null;
}

/** The OAuth wiring the settings card renders (nulls when unknown). */
export interface YouTubeConnectionOauth {
  configured: boolean | null;
  /** the exact env vars missing (not-configured only) */
  missingEnv: string[];
  /** the redirect URI to register in the Google Cloud console */
  redirectUri: string | null;
  connectUrl: string | null;
  disconnectUrl: string | null;
}

export interface YouTubeConnectionState {
  status: YouTubeConnectionStatus;
  /** true only for status "connected" (the action tier answers) */
  connected: boolean;
  account: YouTubeConnectionAccount | null;
  /** the honest capability map: official | local | unsupported (per action) */
  actions: Record<string, string> | null;
  oauth: YouTubeConnectionOauth;
  /** the deployment-wide READ session disclosure (never used for actions) */
  serverReadSession: { configured: boolean } | null;
  /** when the server performed this check (ISO) */
  checkedAt: string;
}

/** The settings anchor the connect/re-auth toast's action opens. */
export const YOUTUBE_CONNECTION_SETTINGS_HREF = "/settings#youtube-connection";

/** The OAuth start path — the fallback when a degraded envelope omits it. */
export const YOUTUBE_OAUTH_CONNECT_HREF = "/api/connection/youtube/oauth/start";

/** How long a connection answer stays fresh (the SWR-style TTL). */
export const CONNECTION_TTL_MS = 30_000;

/** The honest probe-failure state: nothing is known, nothing is claimed. */
function disconnectedState(): YouTubeConnectionState {
  return {
    status: "not-connected",
    connected: false,
    account: null,
    actions: null,
    oauth: {
      configured: null,
      missingEnv: [],
      redirectUri: null,
      connectUrl: null,
      disconnectUrl: null,
    },
    serverReadSession: null,
    checkedAt: new Date().toISOString(),
  };
}

/** A string field → its trimmed truthy value, else null (never a throw). */
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** Narrow whatever /api/connection/youtube answered into the typed state —
 * a missing/garbled field degrades to its falsy shape, never a throw. An
 * unrecognized status degrades to "not-connected" (the honest can't-act
 * verdict — never a claimed connection). */
function normalizeState(body: unknown): YouTubeConnectionState {
  if (typeof body !== "object" || body === null) return disconnectedState();
  const b = body as Record<string, unknown>;
  const status: YouTubeConnectionStatus =
    b.status === "connected" ||
    b.status === "needs-reauth" ||
    b.status === "not-connected" ||
    b.status === "not-configured"
      ? b.status
      : "not-connected";
  const checkedAt =
    typeof b.checkedAt === "string" && b.checkedAt ? b.checkedAt : new Date().toISOString();

  const accountRaw = typeof b.account === "object" && b.account !== null ? b.account : null;
  const account: YouTubeConnectionAccount | null = accountRaw
    ? {
        channelId: strOrNull((accountRaw as Record<string, unknown>).channelId),
        channelTitle: strOrNull((accountRaw as Record<string, unknown>).channelTitle),
        channelThumbUrl: strOrNull((accountRaw as Record<string, unknown>).channelThumbUrl),
        scope: strOrNull((accountRaw as Record<string, unknown>).scope),
        connectedAt: strOrNull((accountRaw as Record<string, unknown>).connectedAt),
      }
    : null;

  const actionsRaw = typeof b.actions === "object" && b.actions !== null ? b.actions : null;
  const actions: Record<string, string> | null = actionsRaw
    ? Object.fromEntries(
        Object.entries(actionsRaw as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : null;

  const oauthRaw = typeof b.oauth === "object" && b.oauth !== null ? b.oauth : null;
  const o = (oauthRaw ?? {}) as Record<string, unknown>;
  const missingEnv = Array.isArray(o.missingEnv)
    ? o.missingEnv.filter((v): v is string => typeof v === "string")
    : [];
  const oauth: YouTubeConnectionOauth = {
    configured: typeof o.configured === "boolean" ? o.configured : null,
    missingEnv,
    redirectUri: strOrNull(o.redirectUri),
    connectUrl: strOrNull(o.connectUrl),
    disconnectUrl: strOrNull(o.disconnectUrl),
  };

  const srsRaw =
    typeof b.serverReadSession === "object" && b.serverReadSession !== null
      ? b.serverReadSession
      : null;
  const serverReadSession =
    srsRaw && typeof (srsRaw as Record<string, unknown>).configured === "boolean"
      ? { configured: (srsRaw as Record<string, unknown>).configured === true }
      : null;

  return {
    status,
    connected: status === "connected" || b.connected === true,
    account,
    actions,
    oauth,
    serverReadSession,
    checkedAt,
  };
}

let cache: { state: YouTubeConnectionState; at: number } | null = null;
let inflight: Promise<YouTubeConnectionState> | null = null;

/**
 * Fetch the YouTube connection state through the ~30s cache. `force`
 * re-probes (the settings card's Recheck button); concurrent callers share one
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

/** Drop the SWR cache — the test isolation hook. */
export function resetYouTubeConnectionCache(): void {
  cache = null;
  inflight = null;
}

/**
 * The write-action error toast (the P36 law): a failure body {error, kind}
 * with kind youtube-not-connected / youtube-needs-reauth renders the
 * connect / re-connect prompt (message + a Settings action that opens the
 * YouTube account card); every other error — quota, provider, store,
 * unsupported — keeps its honest per-surface message.
 */
export function toastActionError(e: unknown, fallback: string): void {
  const kind = e instanceof ApiClientError ? e.kind : undefined;
  if (kind === "youtube-not-connected") {
    toast.error("Connect your YouTube account to act", {
      description:
        "Your likes, subscribes and playlists act on your own YouTube account — connect it in Settings.",
      action: {
        label: "Settings",
        onClick: () => window.location.assign(YOUTUBE_CONNECTION_SETTINGS_HREF),
      },
    });
    return;
  }
  if (kind === "youtube-needs-reauth") {
    toast.error("Re-connect your YouTube account", {
      description:
        "Google expired or revoked the authorization — your actions pause until you re-connect in Settings.",
      action: {
        label: "Settings",
        onClick: () => window.location.assign(YOUTUBE_CONNECTION_SETTINGS_HREF),
      },
    });
    return;
  }
  toast.error(e instanceof Error ? e.message : fallback);
}

/* ------------------------------------------------------------------ */
/* @deprecated WFX2-P36 compat seams (the broker lane is retired) —     */
/* kept ONLY so the lane's pending test re-point type-checks; no        */
/* surface may render them again.                                      */
/* ------------------------------------------------------------------ */

/** @deprecated — the pre-P36 disconnected toast copy, kept for the test
 * re-point (the live copy is the connect/re-auth prompt in toastActionError). */
export const ACTIONS_DISCONNECTED_MESSAGE =
  "YouTube actions are disconnected — check the connection in Settings";

/** @deprecated — the pre-P36 broker-offline error matcher, kept for the
 * test re-point (message-shape matching, no broker import). */
export function isBrokerOfflineError(e: unknown): boolean {
  return (
    e instanceof Error && e.message.toLowerCase().includes("action backend offline")
  );
}
