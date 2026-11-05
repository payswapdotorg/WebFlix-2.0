/**
 * P94-b — the per-user TikTok account connection store (the gap report's
 * G2): the P36 YouTube store cloned verbatim for the second source, with
 * the ONE deliberate divergence the mandate requires — a TikTok binding can
 * be either the official Login Kit OAuth grant (mode "oauth") or the interim
 * unverified profile link (mode "profile_link", status "linked").
 *
 * THE P36 LAW, restated for TikTok: a WebFlix account is a WebFlix
 * IDENTITY, not a TikTok account. Nothing here ever performs a TikTok write
 * (ADR 0004 — TikTok publishes no third-party write API); the binding names
 * the user's own creator identity so the channel pages and the local lanes
 * can act on it honestly.
 *
 * The Upstash adapter pattern (src/lib/auth/youtube-connection-store.ts, the
 * established durable-store law from src/lib/auth/user-store.ts):
 *  - env-configured (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN) →
 *    REST command pipelines against the real Upstash — the production path;
 *  - env absent → an in-memory Map fallback, so dev + tests run env-clean;
 *  - an injectable seam (setTikTokConnectionStoreRest) lets tests exercise
 *    the REST path against a fake — never the network.
 *
 * Key schema (BY LAW a SEPARATE wf:tt: namespace — never mixed with the
 * YouTube connection's wf:yt:conn: keyspace or the tt:* cache entries):
 *   wf:tt:conn:<userId>
 *
 * Token security: accessTokenEnc / refreshTokenEnc are AES-256-GCM blobs
 * produced by src/lib/tiktok/oauth.ts (encryptSecret) — plaintext tokens
 * NEVER touch this store, the logs, or the browser. Records carry no TTL —
 * durable until the user disconnects (or TikTok revokes → needs_reauth).
 */
import type { WebFlixTikTokConnection } from "./types";

// ---------------------------------------------------------------------------
// Key schema
// ---------------------------------------------------------------------------

export const TIKTOK_CONNECTION_KEY_PREFIX = "wf:tt:conn:";

/** The canonical connection-store key for a WebFlix user id. */
export function tiktokConnectionKey(userId: string): string {
  return `${TIKTOK_CONNECTION_KEY_PREFIX}${userId}`;
}

// ---------------------------------------------------------------------------
// REST client — the Upstash adapter pattern (pipeline POST, bearer auth)
// ---------------------------------------------------------------------------

/** Executes a command pipeline; resolves to one result per command. */
export type TikTokConnectionStoreRest = (commands: string[][]) => Promise<unknown[]>;

let injectedRest: TikTokConnectionStoreRest | null = null;

/** Test-only: serve REST command pipelines from a fake. */
export function setTikTokConnectionStoreRest(impl: TikTokConnectionStoreRest | null): void {
  injectedRest = impl;
}

/** A durable-store outage surfaced to the caller (fail honest, never fake). */
export class TikTokConnectionStoreUnavailableError extends Error {
  constructor(cause: string) {
    super(`WebFlix TikTok connection store unavailable: ${cause}`);
    this.name = "TikTokConnectionStoreUnavailableError";
  }
}

/** REST round-trip budget — a slow store must not hang a user action forever. */
const REST_TIMEOUT_MS = 4_000;

/** The env-configured REST client, or null when Upstash is not wired. */
function envRest(): TikTokConnectionStoreRest | null {
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

function activeRest(): TikTokConnectionStoreRest | null {
  return injectedRest ?? envRest();
}

// ---------------------------------------------------------------------------
// The local mirror — dev/tests without Upstash env + the outage fallback
// ---------------------------------------------------------------------------

const g = globalThis as typeof globalThis & { __webflixTikTokConnections?: Map<string, string> };
const local: Map<string, string> = (g.__webflixTikTokConnections ??= new Map());

/** Test hook: wipe the local mirror (NOT the durable Upstash layer). */
export function resetTikTokConnectionStore(): void {
  local.clear();
}

function isConnectionShape(v: unknown): v is WebFlixTikTokConnection {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.userId === "string" &&
    typeof r.handle === "string" &&
    (r.mode === "oauth" || r.mode === "profile_link") &&
    (r.status === "connected" || r.status === "needs_reauth" || r.status === "linked")
  );
}

function parseRecord(raw: string | null | undefined): WebFlixTikTokConnection | null {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as WebFlixTikTokConnection;
    if (!isConnectionShape(record)) return null;
    return record;
  } catch {
    return null; // a corrupt row is an honest miss, never a crash
  }
}

/**
 * Read the user's TikTok connection. Order: local mirror → Upstash (when
 * wired). A REST outage falls back to the local mirror; an unknown user
 * simply misses (not connected — the honest null).
 */
export async function getTikTokConnection(userId: string): Promise<WebFlixTikTokConnection | null> {
  const key = tiktokConnectionKey(userId);
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
export async function putTikTokConnection(record: WebFlixTikTokConnection): Promise<void> {
  const key = tiktokConnectionKey(record.userId);
  const raw = JSON.stringify(record);
  local.set(key, raw);
  const rest = activeRest();
  if (!rest) return;
  try {
    await rest([["SET", key, raw]]);
  } catch (err) {
    throw new TikTokConnectionStoreUnavailableError(
      err instanceof Error ? err.message : "rest write failed",
    );
  }
}

/** Delete the user's connection (disconnect/unlink). True when a record was removed. */
export async function deleteTikTokConnection(userId: string): Promise<boolean> {
  const key = tiktokConnectionKey(userId);
  const existed = local.delete(key);
  const rest = activeRest();
  if (!rest) return existed;
  try {
    const rows = await rest([["DEL", key]]);
    const removedRemote = rows[0] === 1;
    return existed || removedRemote;
  } catch (err) {
    throw new TikTokConnectionStoreUnavailableError(
      err instanceof Error ? err.message : "rest delete failed",
    );
  }
}
