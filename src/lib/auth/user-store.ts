/**
 * WFX2-P2-AU — the WebFlix account user store.
 *
 * The Upstash adapter pattern (the established durable-store law from
 * src/lib/youtube/upstash-cache.ts):
 *  - env-configured (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN) →
 *    REST command pipelines against the real Upstash — the production path;
 *  - env absent → an in-memory Map fallback, so dev + tests run env-clean;
 *  - an injectable seam (setUserStoreRest) lets tests exercise the REST path
 *    against a fake — never the network.
 *
 * Differences from the yt:* cache keys (BY LAW):
 *  - the key schema is `wf:auth:user:<email>` — a SEPARATE wf:auth: namespace
 *    (never mixed with yt:* cache entries). It is a CROSS-APP CONTRACT: the
 *    standalone Studio app (parallel lane) reads/writes the same keys;
 *  - user records NEVER expire — SET carries no TTL/EX. Session JWTs carry
 *    their own expiry; the account record itself is durable.
 */
import type { WebFlixUserRecord } from "./types";

// ---------------------------------------------------------------------------
// Key schema — the cross-app contract
// ---------------------------------------------------------------------------

export const USER_KEY_PREFIX = "wf:auth:user:";

/** The canonical user-store key for an email (case-insensitive identity). */
export function userStoreKey(email: string): string {
  return `${USER_KEY_PREFIX}${email.trim().toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// REST client — the Upstash adapter pattern (pipeline POST, bearer auth)
// ---------------------------------------------------------------------------

/** Executes a command pipeline; resolves to one result per command. */
export type UserStoreRest = (commands: string[][]) => Promise<unknown[]>;

let injectedRest: UserStoreRest | null = null;

/** Test-only: serve REST command pipelines from a fake. */
export function setUserStoreRest(impl: UserStoreRest | null): void {
  injectedRest = impl;
}

/** A durable-store outage surfaced to the caller (fail honest, never fake). */
export class UserStoreUnavailableError extends Error {
  constructor(cause: string) {
    super(`WebFlix account store unavailable: ${cause}`);
    this.name = "UserStoreUnavailableError";
  }
}

/** REST round-trip budget — a slow store must not hang sign-in forever. */
const REST_TIMEOUT_MS = 4_000;

/** The env-configured REST client, or null when Upstash is not wired. */
function envRest(): UserStoreRest | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return async (commands) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REST_TIMEOUT_MS);
    try {
      // the /pipeline endpoint — the integration fix from upstash-cache.ts
      // (the BASE url parses the body as a SINGLE command's argv).
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
      // pipeline → [{result}...]; single command → {result} — normalize both
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

function activeRest(): UserStoreRest | null {
  return injectedRest ?? envRest();
}

// ---------------------------------------------------------------------------
// The local mirror — dev/tests without Upstash env + the outage fallback
// ---------------------------------------------------------------------------

/**
 * globalThis-cached so dev HMR and the test module graph share ONE store
 * (the pattern keeps user records stable across hot reloads / re-imports).
 */
const g = globalThis as typeof globalThis & { __webflixAuthUsers?: Map<string, string> };
const local: Map<string, string> = (g.__webflixAuthUsers ??= new Map());

/** Test hook: wipe the local mirror (NOT the durable Upstash layer). */
export function resetUserStore(): void {
  local.clear();
}

function parseRecord(raw: string | null | undefined): WebFlixUserRecord | null {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as WebFlixUserRecord;
    if (typeof record?.id !== "string" || typeof record?.passwordHash !== "string") {
      return null;
    }
    return record;
  } catch {
    return null; // a corrupt row is an honest miss, never a crash
  }
}

/**
 * Read a user record. Order: local mirror → Upstash (when wired). A REST
 * outage falls back to the local mirror — this instance's writes stay
 * usable; unknown users simply miss (sign-in fails honestly).
 */
export async function getUserRecord(email: string): Promise<WebFlixUserRecord | null> {
  const key = userStoreKey(email);
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
 * Write a user record durably: local mirror ALWAYS, Upstash awaited when
 * wired — registration is only acknowledged after the durable write (a
 * user record must never live on one lambda instance only). SET carries
 * NO expiry — the record is permanent by contract.
 */
export async function putUserRecord(record: WebFlixUserRecord): Promise<void> {
  const key = userStoreKey(record.email);
  const raw = JSON.stringify(record);
  local.set(key, raw);
  const rest = activeRest();
  if (!rest) return;
  try {
    await rest([["SET", key, raw]]);
  } catch (err) {
    throw new UserStoreUnavailableError(err instanceof Error ? err.message : "rest write failed");
  }
}
