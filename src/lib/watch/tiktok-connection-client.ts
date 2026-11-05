"use client";

/**
 * P94-b — the TikTok connection client (browser side): the
 * src/lib/watch/connection-client.ts pattern's second-source twin over
 * GET /api/connection/tiktok. An SWR-style ~30s cache (one probe per TTL
 * window no matter how many surfaces ask; `force` re-probes for the card's
 * Recheck). NEVER rejects — an unreachable route or bad payload is the
 * honest not-connected state, cached like any other answer.
 */

export type TikTokConnectionStatus =
  | "connected"
  | "needs-reauth"
  | "linked"
  | "not-connected"
  | "not-configured";

export interface TikTokConnectionAccount {
  handle: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  scope: string | null;
  connectedAt: string | null;
}

export interface TikTokConnectionOauth {
  configured: boolean | null;
  missingEnv: string[];
  redirectUri: string | null;
  connectUrl: string | null;
  disconnectUrl: string | null;
}

export interface TikTokConnectionState {
  status: TikTokConnectionStatus;
  connected: boolean;
  account: TikTokConnectionAccount | null;
  /** the interim profile-link binding (mode profile_link only) */
  linked: { handle: string; profileUrl: string | null; connectedAt: string | null } | null;
  /** the honest capability map: official | local | unsupported (per action) */
  actions: Record<string, string> | null;
  oauth: TikTokConnectionOauth;
  checkedAt: string;
}

/** The settings anchor the connect prompts' actions open. */
export const TIKTOK_CONNECTION_SETTINGS_HREF = "/settings#tiktok-connection";

/** How long a connection answer stays fresh (the SWR-style TTL). */
export const TIKTOK_CONNECTION_TTL_MS = 30_000;

function disconnectedState(): TikTokConnectionState {
  return {
    status: "not-connected",
    connected: false,
    account: null,
    linked: null,
    actions: null,
    oauth: {
      configured: null,
      missingEnv: [],
      redirectUri: null,
      connectUrl: null,
      disconnectUrl: null,
    },
    checkedAt: new Date().toISOString(),
  };
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** Narrow whatever /api/connection/tiktok answered into the typed state —
 * a missing/garbled field degrades to its falsy shape, never a throw. */
function normalizeState(body: unknown): TikTokConnectionState {
  if (typeof body !== "object" || body === null) return disconnectedState();
  const b = body as Record<string, unknown>;
  const status: TikTokConnectionStatus =
    b.status === "connected" ||
    b.status === "needs-reauth" ||
    b.status === "linked" ||
    b.status === "not-connected" ||
    b.status === "not-configured"
      ? b.status
      : "not-connected";
  const checkedAt =
    typeof b.checkedAt === "string" && b.checkedAt ? b.checkedAt : new Date().toISOString();

  const accountRaw = typeof b.account === "object" && b.account !== null ? b.account : null;
  const account: TikTokConnectionAccount | null = accountRaw
    ? {
        handle: strOrNull((accountRaw as Record<string, unknown>).handle),
        nickname: strOrNull((accountRaw as Record<string, unknown>).nickname),
        avatarUrl: strOrNull((accountRaw as Record<string, unknown>).avatarUrl),
        scope: strOrNull((accountRaw as Record<string, unknown>).scope),
        connectedAt: strOrNull((accountRaw as Record<string, unknown>).connectedAt),
      }
    : null;

  const linkedRaw = typeof b.linked === "object" && b.linked !== null ? b.linked : null;
  const linked = linkedRaw
    ? {
        handle: strOrNull((linkedRaw as Record<string, unknown>).handle) ?? "",
        profileUrl: strOrNull((linkedRaw as Record<string, unknown>).profileUrl),
        connectedAt: strOrNull((linkedRaw as Record<string, unknown>).connectedAt),
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
  const oauth: TikTokConnectionOauth = {
    configured: typeof o.configured === "boolean" ? o.configured : null,
    missingEnv,
    redirectUri: strOrNull(o.redirectUri),
    connectUrl: strOrNull(o.connectUrl),
    disconnectUrl: strOrNull(o.disconnectUrl),
  };

  return {
    status,
    connected: status === "connected" || b.connected === true,
    account,
    linked,
    actions,
    oauth,
    checkedAt,
  };
}

let cache: { state: TikTokConnectionState; at: number } | null = null;
let inflight: Promise<TikTokConnectionState> | null = null;

/** Fetch the TikTok connection state through the ~30s cache. */
export async function fetchTikTokConnection(
  options?: { force?: boolean },
): Promise<TikTokConnectionState> {
  if (!options?.force && cache && Date.now() - cache.at < TIKTOK_CONNECTION_TTL_MS) {
    return cache.state;
  }
  if (inflight) return inflight;
  const probe = (async () => {
    let state: TikTokConnectionState;
    try {
      const res = await fetch("/api/connection/tiktok", { cache: "no-store" });
      if (res.status === 401) throw new Error("unauthenticated");
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
export function resetTikTokConnectionCache(): void {
  cache = null;
  inflight = null;
}
