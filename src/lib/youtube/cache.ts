/**
 * WFX2-A-B cache seam → WFX2-C-W: the same `cached(key, ttl, fn)` contract,
 * now backed by the Upstash adapter (src/lib/youtube/upstash-cache.ts).
 *
 * Every existing call site transparently gains:
 *  - an L1 in-memory layer (the pre-cutover behavior, per lambda instance);
 *  - an L2 Upstash Redis layer when UPSTASH_REDIS_REST_URL + _TOKEN are set
 *    (no-op offline — dev + tests keep working exactly as before);
 *  - stale-while-revalidate past the soft TTL;
 *  - last-good serving when the upstream call fails, within the hard TTL.
 *
 * Rate limiting moved behind the same adapter: fixed-window, per-IP,
 * per-route budgets — INCR/PEXPIRE on Upstash when configured, the local
 * in-memory window otherwise. Response semantics (429 + budgets) unchanged;
 * the check is now awaited.
 */
import {
  cachedResilient,
  clearLocalRateLimits,
  rateLimitFixed,
  resetCacheEngine,
} from "./upstash-cache";

export { cachedResilient, cachePeek } from "./upstash-cache";
export type { ResilientOptions } from "./upstash-cache";

/** TTL constants (architecture doc: search 10m, feeds 5m, watch meta longer). */
export const TTL = {
  SEARCH_MS: 10 * 60_000,
  FEED_MS: 5 * 60_000,
  WATCH_MS: 10 * 60_000,
  COMMENTS_MS: 5 * 60_000,
  SUGGEST_MS: 10 * 60_000,
  /** live-status polls every pollMs (~5s); 30s sheds upstream load honestly */
  LIVE_STATUS_MS: 30_000,
  /** shorts feed surfaces (route-level keys, previously local consts) */
  SHORTS_SEED_MS: 5 * 60_000,
  SHORTS_META_MS: 10 * 60_000,
  /**
   * The home browse entry's last-good window — one warm buys a full day: a
   * daily warmer cadence keeps home alive, and stale-but-REAL beats
   * honest-empty for a clone. The 5-minute soft TTL (FEED_MS) + SWR still
   * refreshes whenever an unwalled request comes through.
   */
  HOME_HARD_MS: 24 * 3_600_000,
} as const;

/** Get-or-compute with TTL + in-flight dedupe (+ L2/SWR/last-good via the adapter). */
export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  return cachedResilient<T>(key, ttlMs, fn);
}

/** Test hook: wipe the cache between route-handler invocations. */
export function clearCache(): void {
  resetCacheEngine();
}

// ---------------------------------------------------------------------------
// Rate limiting — fixed window per key (per route+IP), adapter-backed.
// Stands down automatically while a test upstream serves fixtures.
// ---------------------------------------------------------------------------

export interface RateLimitOptions {
  limit?: number;
  windowMs?: number;
}

/**
 * Returns true when the call is allowed. Default: 120 requests / 60s per key
 * (the app caches aggressively upstream of this, so client bursts are cheap).
 * Awaited since WFX2-C-W (the counter may live on Upstash).
 */
export async function rateLimit(key: string, opts: RateLimitOptions = {}): Promise<boolean> {
  return rateLimitFixed(key, opts.limit ?? 120, opts.windowMs ?? 60_000);
}

/** Test hook. */
export function clearRateLimits(): void {
  clearLocalRateLimits();
}
