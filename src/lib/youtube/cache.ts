/**
 * WFX2-A-B in-memory TTL cache + rate limiting around upstream calls.
 *
 * Upstash Redis arrives in a later wave; the `cached(key, ttl, fn)` interface
 * is the seam it will replace (a Map today, Upstash later — same signature).
 * In-flight calls are deduped so a cold key hit by concurrent requests makes
 * exactly one upstream call.
 */
import { isTestUpstream } from "./upstream";

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const store = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 500;

function sweep(now: number): void {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  if (store.size > MAX_ENTRIES) {
    // evict oldest-expiring entries first
    const sorted = [...store.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (const [key] of sorted.slice(0, store.size - MAX_ENTRIES)) store.delete(key);
  }
}

/** TTL constants (architecture doc: search 10m, feeds 5m, watch meta longer). */
export const TTL = {
  SEARCH_MS: 10 * 60_000,
  FEED_MS: 5 * 60_000,
  WATCH_MS: 10 * 60_000,
  COMMENTS_MS: 5 * 60_000,
  SUGGEST_MS: 10 * 60_000,
} as const;

/** Get-or-compute with TTL + in-flight dedupe. Errors are never cached. */
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = fn()
    .then((value) => {
      store.set(key, { expiresAt: Date.now() + ttlMs, value });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

/** Test hook: wipe the cache between route-handler invocations. */
export function clearCache(): void {
  store.clear();
  inflight.clear();
}

// ---------------------------------------------------------------------------
// Rate limiting — a simple fixed window counter per key (per route+IP).
// Stands down automatically while a test upstream serves fixtures.
// ---------------------------------------------------------------------------

interface WindowState {
  windowStart: number;
  count: number;
}

const windows = new Map<string, WindowState>();

export interface RateLimitOptions {
  limit?: number;
  windowMs?: number;
}

/**
 * Returns true when the call is allowed. Default: 120 requests / 60s per key
 * (the app caches aggressively upstream of this, so client bursts are cheap).
 */
export function rateLimit(key: string, opts: RateLimitOptions = {}): boolean {
  if (isTestUpstream()) return true;
  const limit = opts.limit ?? 120;
  const windowMs = opts.windowMs ?? 60_000;
  const now = Date.now();
  const state = windows.get(key);
  if (!state || now - state.windowStart >= windowMs) {
    windows.set(key, { windowStart: now, count: 1 });
    return true;
  }
  state.count += 1;
  return state.count <= limit;
}

/** Test hook. */
export function clearRateLimits(): void {
  windows.clear();
}
