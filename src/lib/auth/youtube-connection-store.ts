/**
 * WFX2-P36-ACTION-PERSISTENCE — the per-user YouTube account connection store.
 *
 * THE P36 LAW (docs/work-items/P36-ACTION-PERSISTENCE.md): app sign-in is a
 * WebFlix IDENTITY, not YouTube authorization. Every end-user write must act
 * on the signed-in user's OWN connected YouTube account, bound through the
 * official Google OAuth flow. This store holds that binding — one record per
 * WebFlix user (userId = the NextAuth token sub), holding the user's own
 * channel identity + the encrypted OAuth tokens.
 *
 * The Upstash adapter pattern (the established durable-store law from
 * src/lib/auth/user-store.ts):
 *  - env-configured (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN) →
 *    REST command pipelines against the real Upstash — the production path;
 *  - env absent → an in-memory Map fallback, so dev + tests run env-clean;
 *  - an injectable seam (setYoutubeConnectionStoreRest) lets tests exercise
 *    the REST path against a fake — never the network.
 *
 * Key schema (BY LAW a SEPARATE wf:yt: namespace, never mixed with yt:*
 * cache entries or wf:auth:user: account rows):
 *   wf:yt:conn:<userId>
 *
 * Token security (the work order's contract):
 *  - accessTokenEnc / refreshTokenEnc are AES-256-GCM blobs produced by
 *    src/lib/youtube/oauth.ts (encryptSecret) — the plaintext tokens NEVER
 *    touch this store, the logs, or the browser;
 *  - records carry no TTL — a connection is durable until the user
 *    disconnects or Google revokes consent (status → needs_reauth).
 */
import type { WebFlixYouTubeConnection } from "./types";

// ---------------------------------------------------------------------------
// Key schema
// ---------------------------------------------------------------------------

export const YT_CONNECTION_KEY_PREFIX = "wf:yt:conn:";

/** The canonical connection-store key for a WebFlix user id. */
export function youtubeConnectionKey(userId: string): string {
  return `${YT_CONNECTION_KEY_PREFIX}${userId}`;
}

// ---------------------------------------------------------------------------
// REST client — the Upstash adapter pattern (pipeline POST, bearer auth)
// ---------------------------------------------------------------------------

/** Executes a command pipeline; resolves to one result per command. */
export type YoutubeConnectionStoreRest = (commands: string[][]) => Promise<unknown[]>;

let injectedRest: YoutubeConnectionStoreRest | null = null;

/** Test-only: serve REST command pipelines from a fake. */
export function setYoutubeConnectionStoreRest(impl: YoutubeConnectionStoreRest | null): void {
  injectedRest = impl;
}

/** A durable-store outage surfaced to the caller (fail honest, never fake). */
export class YoutubeConnectionStoreUnavailableError extends Error {
  constructor(cause: string) {
    super(`WebFlix YouTube connection store unavailable: ${cause}`);
    this.name = "YoutubeConnectionStoreUnavailableError";
  }
}

/** REST round-trip budget — a slow store must not hang a user action forever. */
const REST_TIMEOUT_MS = 4_000;

/** The env-configured REST client, or null when Upstash is not wired. */
function envRest(): YoutubeConnectionStoreRest | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return async (commands) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REST_TIMEOUT_MS);
    try {
      const pipelineUrl = url.replace(/\/+$/, "") + "/pipeline";
      const res = await fetch(pipelineUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(commands),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`upstash rest ${res.status}`);
      const body = (await res.json()) as unknown;
      const rows = Array.isArray(body) ? body : [body];
      return rows.map((row) =>
        row && typeof row === "object" && "result" in row
          ? (row as { result: unknown }).result
          : null,
      );
    } finally {
      clearTimeout(timer);
    }
  };
}

function activeRest(): YoutubeConnectionStoreRest | null {
  return injectedRest ?? envRest();
}

// ---------------------------------------------------------------------------
// The local mirror — dev/tests without Upstash env + the outage fallback
// ---------------------------------------------------------------------------

const g = globalThis as typeof globalThis & { __webflixYouTubeConnections?: Map<string, string> };
const local: Map<string, string> = (g.__webflixYouTubeConnections ??= new Map());

/** Test hook: wipe the local mirror (NOT the durable Upstash layer). */
export function resetYoutubeConnectionStore(): void {
  local.clear();
}

function isConnectionShape(v: unknown): v is WebFlixYouTubeConnection {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.userId === "string" && typeof r.accessTokenEnc === "string";
}

function parseRecord(raw: string | null | undefined): WebFlixYouTubeConnection | null {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as WebFlixYouTubeConnection;
    if (!isConnectionShape(record)) return null;
    return record;
  } catch {
    return null; // a corrupt row is an honest miss, never a crash
  }
}

/**
 * Read the user's YouTube connection. Order: local mirror → Upstash (when
 * wired). A REST outage falls back to the local mirror; an unknown user
 * simply misses (not connected — the honest null).
 */
export async function getYouTubeConnection(userId: string): Promise<WebFlixYouTubeConnection | null> {
  const key = youtubeConnectionKey(userId);
  const localHit = parseRecord(local.get(key));
  if (localHit) return localHit;
  const rest = activeRest();
  if (!rest) return null;
  try {
    const rows = await rest([["GET", key]]);
    const record = parseRecord(typeof rows[0] === "string" ? rows[0] : null);
    if (record) local.set(key, JSON.stringify(record)); // mirror the durable read
    return record;
  } catch {
    return null; // read path must never break the request
  }
}

/**
 * Write a connection durably: local mirror ALWAYS, Upstash awaited when
 * wired — a connection must never live on one lambda instance only. SET
 * carries no expiry (durable by contract; revocation flips the status).
 */
export async function putYouTubeConnection(record: WebFlixYouTubeConnection): Promise<void> {
  const key = youtubeConnectionKey(record.userId);
  const raw = JSON.stringify(record);
  local.set(key, raw);
  const rest = activeRest();
  if (!rest) return;
  try {
    await rest([["SET", key, raw]]);
  } catch (err) {
    throw new YoutubeConnectionStoreUnavailableError(
      err instanceof Error ? err.message : "rest write failed",
    );
  }
}

/** Delete the user's connection (disconnect). Returns true when a record was removed. */
export async function deleteYouTubeConnection(userId: string): Promise<boolean> {
  const key = youtubeConnectionKey(userId);
  const existed = local.delete(key);
  const rest = activeRest();
  if (!rest) return existed;
  try {
    const rows = await rest([["DEL", key]]);
    const removedRemote = rows[0] === 1;
    return existed || removedRemote;
  } catch (err) {
    throw new YoutubeConnectionStoreUnavailableError(
      err instanceof Error ? err.message : "rest delete failed",
    );
  }
}

/** Flip a connection to needs_reauth (refresh refused — consent revoked/expired). */
export async function markYouTubeConnectionNeedsReauth(userId: string): Promise<void> {
  const record = await getYouTubeConnection(userId);
  if (!record || record.status === "needs_reauth") return;
  await putYouTubeConnection({
    ...record,
    status: "needs_reauth",
    updatedAt: new Date().toISOString(),
  });
}
