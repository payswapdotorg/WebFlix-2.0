/**
 * WFX2-C-W — the Upstash Redis REST cache adapter (the cutover lane's core).
 *
 * Production wiring (verified live 2026-09-30: youtube.com walls the InnerTube
 * `browse` endpoint for Vercel's datacenter IPs — the call answers 200 with a
 * body that maps to ZERO content, which is why /api/home served empty rails
 * from Vercel while search/trending-SSR kept working). The fix shipped here:
 *
 *  L1  in-memory Map, per lambda instance — the old `cached()` behavior;
 *  L2  Upstash Redis (REST, UPSTASH_REDIS_REST_URL + _TOKEN env) shared
 *      across instances, entries self-expiring at the hard TTL via `EX`;
 *  SWR stale-while-revalidate — a soft-TTL-expired entry is served
 *      immediately while a single background revalidation refreshes it;
 *  last-good — when the upstream fetch throws OR returns an "unhealthy"
 *      value (the walled 200-but-empty browse shape, detected per call site
 *      via `isEmpty`), the last good payload keeps serving until the hard
 *      TTL expires. NO fake data is ever synthesized: with no last-good the
 *      honest empty/error response goes through untouched.
 *
 * A cold-start warmer (scripts/warm-cache.mjs, run from a non-Vercel egress
 * with the same Upstash env) keeps L2 populated so the walled Vercel egress
 * always has a last-good payload to serve.
 *
 * Offline safety (the lane laws):
 *  - no env vars → L2 is a no-op; dev + tests run on L1 exactly as before;
 *  - a test upstream (setUpstream fixtures) → L2 is skipped entirely, so
 *    route tests can never touch the network even on a machine with the
 *    Upstash env configured;
 *  - the adapter has its own injectable seam `setUpstashRest()` for tests.
 */
import { isTestUpstream } from "./upstream";

// ---------------------------------------------------------------------------
// REST client — POST command pipelines to the Upstash REST endpoint
// ---------------------------------------------------------------------------

export type RestCommand = string[];
/** Executes a command pipeline; resolves to one result per command (null on error rows). */
export type UpstashRest = (commands: RestCommand[]) => Promise<unknown[]>;

/** REST round-trip budget — a slow cache must never slow the request path. */
const REST_TIMEOUT_MS = 4_000;
/** Upstash command-size guard: payloads above this stay L1-only. */
const MAX_VALUE_BYTES = 768 * 1024;

let injectedRest: UpstashRest | null = null;

/** Test-only: serve REST command pipelines from a fake. */
export function setUpstashRest(impl: UpstashRest | null): void {
  injectedRest = impl;
}

/** True while a fake REST client is injected. */
export function isTestUpstash(): boolean {
  return injectedRest !== null;
}

/** The env-configured REST client, or null when Upstash is not wired. */
function envRest(): UpstashRest | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return async (commands) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REST_TIMEOUT_MS);
    try {
      // 2026-09-30 integration fix (lead): the command pipeline must POST to
      // the /pipeline endpoint — the BASE url parses the body as a SINGLE
      // command's argv, so the nested [[...]] body errored ("unsupported
      // arg type") and every L2 write failed silently (the lane's tests ran
      // on the injected fake and never exercised the real endpoint shape).
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

function activeRest(): UpstashRest | null {
  return injectedRest ?? envRest();
}

/** True when L2 is usable (env configured or a test fake injected). */
export function upstashEnabled(): boolean {
  return activeRest() !== null;
}

/**
 * L2 may only be touched when it is genuinely active AND we are not serving
 * fixture upstreams without an injected REST fake (the no-live-network law).
 */
function l2Active(): boolean {
  if (injectedRest) return true;
  if (isTestUpstream()) return false;
  return upstashEnabled();
}

// ---------------------------------------------------------------------------
// JSON get/set/peek — the adapter's raw operations
// ---------------------------------------------------------------------------

/** The L2 envelope schema (versioned for future evolution). */
interface CacheEnvelope {
  v: 1;
  value: unknown;
  softUntil: number;
  hardUntil: number;
}

interface EngineEntry {
  value: unknown;
  softUntil: number;
  hardUntil: number;
}

function toEnvelope(entry: EngineEntry): CacheEnvelope {
  return { v: 1, value: entry.value, softUntil: entry.softUntil, hardUntil: entry.hardUntil };
}

function fromEnvelope(env: unknown): EngineEntry | null {
  if (typeof env !== "object" || env === null) return null;
  const e = env as Partial<CacheEnvelope>;
  if (e.v !== 1 || typeof e.softUntil !== "number" || typeof e.hardUntil !== "number") return null;
  return { value: e.value, softUntil: e.softUntil, hardUntil: e.hardUntil };
}

async function l2Get(key: string): Promise<EngineEntry | null> {
  if (!l2Active()) return null;
  try {
    const rows = await activeRest()!([["GET", key]]);
    return fromEnvelope(typeof rows[0] === "string" ? JSON.parse(rows[0]) : null);
  } catch {
    return null; // the cache must never break the request
  }
}

function l2Set(key: string, entry: EngineEntry): void {
  if (!l2Active()) return;
  const rest = activeRest();
  if (!rest) return;
  const raw = JSON.stringify(toEnvelope(entry));
  if (raw.length > MAX_VALUE_BYTES) return;
  const exSec = Math.max(1, Math.ceil((entry.hardUntil - Date.now()) / 1000));
  void rest([["SET", key, raw, "EX", String(exSec)]]).catch(() => {
    /* best-effort write; the L1 copy still serves this instance */
  });
}

/** Raw JSON read (L1 fresh → L2). Returns null on miss — never throws. */
export async function cacheJsonGet<T>(key: string): Promise<T | null> {
  const now = Date.now();
  const local = l1.get(key);
  if (local && local.softUntil > now) return local.value as T;
  const remote = await l2Get(key);
  return remote && remote.softUntil > now ? (remote.value as T) : null;
}

/** Raw JSON write with a plain TTL (both layers). Never throws. */
export async function cacheJsonSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
  const now = Date.now();
  const entry: EngineEntry = { value, softUntil: now + ttlMs, hardUntil: now + ttlMs };
  l1Sweep(now);
  l1.set(key, entry);
  l2Set(key, entry);
}

/**
 * Read-only inspection for ops/warmer tooling: where the entry lives, whether
 * it is fresh, and when it stops being a last-good candidate. No revalidation,
 * no side effects.
 */
export async function cachePeek<T>(
  key: string,
): Promise<{ value: T; fresh: boolean; softUntil: number; hardUntil: number } | null> {
  const now = Date.now();
  const local = l1.get(key);
  if (local && local.hardUntil > now) {
    return {
      value: local.value as T,
      fresh: local.softUntil > now,
      softUntil: local.softUntil,
      hardUntil: local.hardUntil,
    };
  }
  const remote = await l2Get(key);
  if (remote && remote.hardUntil > now) {
    return {
      value: remote.value as T,
      fresh: remote.softUntil > now,
      softUntil: remote.softUntil,
      hardUntil: remote.hardUntil,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The resilient cache engine — L1 + L2 + SWR + last-good + in-flight dedupe
// ---------------------------------------------------------------------------

const l1 = new Map<string, EngineEntry>();
const inflight = new Map<string, Promise<unknown>>();
const revalidating = new Set<string>();
/** Keys whose fn is currently executing — the re-entrancy guard (see below). */
const computing = new Set<string>();
const L1_MAX_ENTRIES = 500;

function l1Sweep(now: number): void {
  for (const [key, entry] of l1) {
    if (entry.hardUntil <= now) l1.delete(key);
  }
  if (l1.size > L1_MAX_ENTRIES) {
    // evict the soonest-expiring entries first
    const sorted = [...l1.entries()].sort((a, b) => a[1].hardUntil - b[1].hardUntil);
    for (const [key] of sorted.slice(0, l1.size - L1_MAX_ENTRIES)) l1.delete(key);
  }
}

export interface ResilientOptions {
  /**
   * Unhealthy-value detector — the walled-browse failure mode: upstream
   * answers 200 but the payload maps to zero content. `true` → the value is
   * NEVER cached (poisoning guard) and the last-good payload is served
   * instead when one exists. With no last-good the honest empty value is
   * returned untouched (never fake data).
   */
  isEmpty?: (value: unknown) => boolean;
  /**
   * How long the entry survives as stale/last-good (default: ttl × 12,
   * clamped to [5 min, 2 h]). The L2 key self-expires at this boundary.
   */
  hardTtlMs?: number;
}

function defaultHardTtl(ttlMs: number): number {
  return Math.min(Math.max(ttlMs * 12, 5 * 60_000), 2 * 3_600_000);
}

async function lastGoodFor(key: string, now: number): Promise<EngineEntry | null> {
  const local = l1.get(key);
  if (local && local.hardUntil > now) return local;
  const remote = await l2Get(key);
  if (remote && remote.hardUntil > now) return remote;
  return null;
}

/**
 * Resolve a key that is neither fresh in L1 nor in-flight: consult L2
 * (unless the caller forces a recompute), else compute + store. The isEmpty
 * predicate guards the walled-browse shape; failures fall back to last-good.
 */
async function resolveEntry<T>(
  key: string,
  ttlMs: number,
  hardTtlMs: number,
  fn: () => Promise<T>,
  opts: ResilientOptions,
  forceCompute: boolean,
): Promise<T> {
  if (!forceCompute) {
    const remote = await l2Get(key);
    const now = Date.now();
    if (remote && remote.hardUntil > now) {
      l1.set(key, remote);
      if (remote.softUntil <= now) triggerRevalidate(key, ttlMs, hardTtlMs, fn, opts);
      return remote.value as T;
    }
  }
  try {
    // re-entrancy guard: a nested cachedResilient call with the SAME key
    // (e.g. a route wrapping a lib helper that caches internally) must not
    // dedupe onto the outer in-flight promise — that is a circular wait.
    // While fn runs, same-key callers skip the in-flight fast path and
    // compute independently (the pre-cutover engine's behavior).
    computing.add(key);
    try {
      const value = await fn();
      if (opts.isEmpty?.(value) === true) {
        // unhealthy upstream answer — never poison the cache; serve last-good
        const lastGood = await lastGoodFor(key, Date.now());
        if (lastGood) return lastGood.value as T;
        return value; // cold cache: the honest empty response goes through
      }
      const storedAt = Date.now();
      const entry: EngineEntry = {
        value,
        softUntil: storedAt + ttlMs,
        hardUntil: storedAt + hardTtlMs,
      };
      l1Sweep(storedAt);
      l1.set(key, entry);
      l2Set(key, entry);
      return value;
    } finally {
      computing.delete(key);
    }
  } catch (err) {
    // upstream hard-failure — last-good keeps the surface alive
    const lastGood = await lastGoodFor(key, Date.now());
    if (lastGood) return lastGood.value as T;
    throw err;
  }
}

/** Fire the single background refresh for a stale entry (SWR). */
function triggerRevalidate<T>(
  key: string,
  ttlMs: number,
  hardTtlMs: number,
  fn: () => Promise<T>,
  opts: ResilientOptions,
): void {
  if (revalidating.has(key) || inflight.has(key)) return;
  revalidating.add(key);
  const p = resolveEntry(key, ttlMs, hardTtlMs, fn, opts, true)
    .catch(() => {
      /* background refresh failed — the stale entry stays until hard TTL */
    })
    .finally(() => {
      inflight.delete(key);
      revalidating.delete(key);
    });
  inflight.set(key, p);
}

/**
 * Get-or-compute with the full cutover resilience contract:
 *
 *  fresh (now < softUntil)          → served from L1/L2, zero upstream calls;
 *  stale (softUntil ≤ now < hard)   → served immediately + ONE background
 *                                     revalidation (stale-while-revalidate);
 *  cold / hard-expired              → awaited compute, in-flight deduped
 *                                     (the registration covers the L2 read
 *                                     too, so concurrent cold requests
 *                                     compute exactly once);
 *  compute fails / isEmpty          → last-good within the hard window,
 *                                     else the honest error/empty result.
 *
 * The response value is byte-identical to what `fn` returns — caching is
 * transparent to DTO shapes.
 */
export async function cachedResilient<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  opts: ResilientOptions = {},
): Promise<T> {
  const hardTtlMs = opts.hardTtlMs ?? defaultHardTtl(ttlMs);
  const now = Date.now();

  const hit = l1.get(key);
  if (hit && hit.softUntil > now) return hit.value as T; // fresh L1

  const pending = inflight.get(key);
  // dedupe concurrent cold hits — unless the key's own computation is on the
  // stack (a nested same-key call must run its own compute; see resolveEntry)
  if (pending && !computing.has(key)) return pending as Promise<T>;

  if (hit && hit.hardUntil > now) {
    // stale L1 — serve now, refresh once in the background
    triggerRevalidate(key, ttlMs, hardTtlMs, fn, opts);
    return hit.value as T;
  }

  // register the whole remainder (L2 read + compute) as the in-flight value
  const p = resolveEntry<T>(key, ttlMs, hardTtlMs, fn, opts, false).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

/** Test hook: wipe the whole engine (L1 + in-flight + revalidating flags). */
export function resetCacheEngine(): void {
  l1.clear();
  inflight.clear();
  revalidating.clear();
  computing.clear();
}

// ---------------------------------------------------------------------------
// Fixed-window rate limiting — the same adapter, per-IP + per-route budgets
// ---------------------------------------------------------------------------

interface WindowState {
  windowStart: number;
  count: number;
}

const localWindows = new Map<string, WindowState>();

/** The offline fallback: a per-key fixed window in local memory (dev/tests). */
function rateLimitFixedLocal(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const state = localWindows.get(key);
  if (!state || now - state.windowStart >= windowMs) {
    localWindows.set(key, { windowStart: now, count: 1 });
    return true;
  }
  state.count += 1;
  return state.count <= limit;
}

/**
 * Fixed-window budget check. Distributed path: one INCR + PEXPIRE pipeline on
 * a per-window key (`wfx2:rl:<route:ip>:<windowIndex>`) — atomic on Upstash,
 * shared across instances. Local path when the adapter is offline.
 *
 * Failure policy: fail-open (a cache outage must not 429 the site); fixture
 * upstreams stand down entirely, exactly like the pre-cutover limiter.
 */
export async function rateLimitFixed(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  if (isTestUpstream() && !injectedRest) return true;
  const rest = activeRest();
  if (!rest) return rateLimitFixedLocal(key, limit, windowMs);
  try {
    const windowIndex = Math.floor(Date.now() / windowMs);
    const windowKey = `wfx2:rl:${key}:${windowIndex}`;
    const rows = await rest([
      ["INCR", windowKey],
      ["PEXPIRE", windowKey, String(windowMs * 3)],
    ]);
    const count = Number(rows[0]);
    return Number.isFinite(count) && count > 0 ? count <= limit : true;
  } catch (err) {
    console.error("rate-limit adapter unavailable (fail-open)", err);
    return true;
  }
}

/** Test hook: wipe the local fallback windows. */
export function clearLocalRateLimits(): void {
  localWindows.clear();
}
