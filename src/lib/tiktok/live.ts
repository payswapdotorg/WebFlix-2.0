/**
 * P100-TIKTOK-LIVE — the in-app LIVE lane (docs/research/2026-11-07-p100-
 * tiktok-live-in-app-report.md): room status resolution + the honest probing
 * state, riding the Apify status actor (the empirically verified provider,
 * report §1 probe E4) through the live-upstream seam.
 *
 * Laws this module implements:
 *  - the probing DTO (`live: null, probing: true`) is a first-class answer —
 *    a probe in flight is never rendered as offline, and a provider failure
 *    is a typed 502/503, never a fake row;
 *  - the cache TTL is LIVENESS-DEPENDENT (a LIVE answer lives 30s; an
 *    offline answer 300s — a probe costs the operator real cents, so the
 *    offline answer is cached 10× longer; the cost law);
 *  - one probe per handle per process (in-flight coalescing, globalThis-
 *    keyed like the live hub seam so dev hot-reload and bun tests share it);
 *  - a failed probe puts the handle in a 60s failure backoff, and peek
 *    surfaces the REAL error during backoff (no hammering, no faking);
 *  - the state machine is run → poll (capped) → dataset → map, every rung
 *    testable against the injected transport.
 */
import { isTikTokHandle, normalizeTikTokHandle, tiktokLiveRoomUrl } from "./urls";
import { tiktokLiveProbeFetch } from "./live-upstream";

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

/** The live room payload when the creator is actually live. */
export interface TikTokLiveRoomInfo {
  title: string | null;
  viewers: number | null;
  startedAt: string | null;
  coverUrl: string | null;
  /** The outbound TikTok deep link — built by the URL law, never trusted. */
  liveUrl: string;
}

/** Extracted stream URLs when a provider yields them (playback ladder rung 1). */
export interface TikTokLiveStreamInfo {
  hlsUrl: string | null;
  flvUrl: string | null;
}

/** The status DTO every live surface consumes. */
export interface TikTokLiveStatusDTO {
  handle: string;
  /** null = unknown (probe in flight) — never render that as offline. */
  live: boolean | null;
  probing?: boolean;
  room: TikTokLiveRoomInfo | null;
  stream: TikTokLiveStreamInfo | null;
  source: "apify" | "webcast" | "";
  fetchedAt: string;
}

/** A provider failure the caller must surface honestly. */
export class TikTokLiveUnavailableError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TikTokLiveUnavailableError";
    this.status = status;
  }
}

/** The probing DTO the route synthesizes while a probe is in flight. */
export function probingTikTokLiveStatus(handle: string): TikTokLiveStatusDTO {
  return {
    handle,
    live: null,
    probing: true,
    room: null,
    stream: null,
    source: "",
    fetchedAt: new Date().toISOString(),
  };
}

/** The cache TTL law: LIVE 30s, OFFLINE 300s (cost law), probing 60s. */
export function liveStatusTtlMs(status: Pick<TikTokLiveStatusDTO, "live">): number {
  if (status.live === true) return 30_000;
  if (status.live === false) return 300_000;
  return 60_000;
}

// ---------------------------------------------------------------------------
// Provider mappers (defensive: malformed input answers honest nulls, never
// throws — the channels.ts honesty law applied to live rows)
// ---------------------------------------------------------------------------

/** The first m3u8 / flv string in an actor's stream_urls array, if any. */
function streamFromActorList(raw: unknown): TikTokLiveStreamInfo | null {
  if (!Array.isArray(raw)) return null;
  const urls = raw.filter((u): u is string => typeof u === "string" && u.startsWith("https://"));
  if (urls.length === 0) return null;
  return {
    hlsUrl: urls.find((u) => u.includes(".m3u8")) ?? null,
    flvUrl: urls.find((u) => u.includes(".flv")) ?? null,
  };
}

/**
 * Map one Apify actor row (the P100 report's empirically captured shape) to
 * the status DTO for `handle`. A row whose identity mismatches answers null
 * (the caller selects by unique_id/handle); malformed fields become honest
 * nulls; `is_live !== true` is a REAL offline answer.
 */
export function mapApifyLiveRow(row: unknown, handle: string): TikTokLiveStatusDTO | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const identity = [r.unique_id, r.handle]
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.toLowerCase());
  if (!identity.includes(handle.toLowerCase())) return null;
  const meta = (r._metadata ?? {}) as Record<string, unknown>;
  const live = r.is_live === true;
  const viewers = typeof r.viewer_count === "number" ? r.viewer_count : null;
  return {
    handle,
    live,
    room: live
      ? {
          title: typeof r.room_title === "string" ? r.room_title : null,
          viewers,
          startedAt: typeof r.started_at === "string" ? r.started_at : null,
          coverUrl: typeof r.cover_url === "string" ? r.cover_url : null,
          liveUrl: tiktokLiveRoomUrl(handle),
        }
      : null,
    stream: streamFromActorList(r.stream_urls),
    source: "apify",
    fetchedAt: typeof meta.fetched_at === "string" ? meta.fetched_at : new Date().toISOString(),
  };
}

/**
 * Map the DOCUMENTED webcast room/info payload (P100 report §4) to the DTO.
 * status 2 = live, 4 = offline; the structured error envelope (status_code
 * present) answers null. Contract-ready: activates the moment a provider
 * yields a room_id (report §6).
 */
export function mapWebcastRoom(payload: unknown, handle: string): TikTokLiveStatusDTO | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.status_code === "number") return null; // the 10011 error family
  if (typeof p.status !== "number") return null;
  const live = p.status === 2;
  if (!live) {
    return {
      handle,
      live: false,
      room: null,
      stream: null,
      source: "webcast",
      fetchedAt: new Date().toISOString(),
    };
  }
  const stats = (p.live_room_stats ?? {}) as Record<string, unknown>;
  const streamUrl = (p.stream_url ?? {}) as Record<string, unknown>;
  const hls = typeof streamUrl.hls_pull_url === "string" ? streamUrl.hls_pull_url : null;
  const flv = typeof streamUrl.rtmp_pull_url === "string" ? streamUrl.rtmp_pull_url : null;
  return {
    handle,
    live: true,
    room: {
      title: typeof p.title === "string" ? p.title : null,
      viewers: typeof stats.user_count === "number" ? stats.user_count : null,
      // the webcast epoch is seconds — normalize to ISO
      startedAt:
        typeof p.start_time === "number" ? new Date(p.start_time * 1000).toISOString() : null,
      coverUrl: null,
      liveUrl: tiktokLiveRoomUrl(handle),
    },
    stream: hls || flv ? { hlsUrl: hls, flvUrl: flv } : null,
    source: "webcast",
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// The Apify probe state machine (run → poll → dataset → map)
// ---------------------------------------------------------------------------

const DEFAULT_ACTOR_ID = "unseenuser~tiktok-live-status-scraper";
const PROBE_TIMEOUT_SECS = 120;

/** Polling is injectable so tests exercise the cap deterministically. */
let pollIntervalMs = 5_000;
let pollMaxAttempts = 30;

export function setTikTokLiveProbePolling(opts: { intervalMs: number; maxAttempts: number } | null): void {
  if (!opts) {
    pollIntervalMs = 5_000;
    pollMaxAttempts = 30;
    return;
  }
  pollIntervalMs = opts.intervalMs;
  pollMaxAttempts = opts.maxAttempts;
}

/** The lane is configured iff the operator key is present. */
export function isTikTokLiveProbeLaneConfigured(): boolean {
  return Boolean(process.env.APIFY_API_KEY);
}

const globalForLive = globalThis as unknown as {
  __wfx2TikTokLiveCache?: Map<string, { dto: TikTokLiveStatusDTO; expiresAt: number }>;
  __wfx2TikTokLiveBackoff?: Map<string, { status: number; message: string; until: number }>;
  __wfx2TikTokLiveInFlight?: Map<string, Promise<TikTokLiveStatusDTO>>;
};

const cache: Map<string, { dto: TikTokLiveStatusDTO; expiresAt: number }> =
  globalForLive.__wfx2TikTokLiveCache ?? new Map();
globalForLive.__wfx2TikTokLiveCache = cache;

const backoff: Map<string, { status: number; message: string; until: number }> =
  globalForLive.__wfx2TikTokLiveBackoff ?? new Map();
globalForLive.__wfx2TikTokLiveBackoff = backoff;

const inFlight: Map<string, Promise<TikTokLiveStatusDTO>> =
  globalForLive.__wfx2TikTokLiveInFlight ?? new Map();
globalForLive.__wfx2TikTokLiveInFlight = inFlight;

/** Test/freshness hook: drop every cached status and backoff marker. */
export function clearTikTokLiveCache(): void {
  cache.clear();
  backoff.clear();
  inFlight.clear();
}

/** True while a probe for `handle` is in flight (route coalescing). */
export function isTikTokLiveProbeInFlight(handle: string): boolean {
  return inFlight.has(normalizeTikTokHandle(handle));
}

/** Cache-only read. Throws the REAL error while a handle is in backoff. */
export async function peekTikTokLiveStatus(handle: string): Promise<TikTokLiveStatusDTO | null> {
  const key = normalizeTikTokHandle(handle);
  if (!key || !isTikTokHandle(key)) return null;
  const marker = backoff.get(key);
  if (marker && marker.until > Date.now()) {
    throw new TikTokLiveUnavailableError(marker.message, marker.status);
  }
  if (marker) backoff.delete(key);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.dto;
  if (hit) cache.delete(key);
  return null;
}

function cacheStatus(dto: TikTokLiveStatusDTO): void {
  cache.set(dto.handle, { dto, expiresAt: Date.now() + liveStatusTtlMs(dto) });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

/**
 * Run one Apify probe for `handle` and cache the mapped result. Concurrent
 * calls for the same handle coalesce onto ONE state machine. Invalid
 * handles answer null without touching the transport.
 */
export async function probeTikTokLiveStatus(handle: string): Promise<TikTokLiveStatusDTO | null> {
  const key = normalizeTikTokHandle(handle);
  if (!key || !isTikTokHandle(key)) return null;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = runProbe(key).finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

async function runProbe(key: string): Promise<TikTokLiveStatusDTO> {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) {
    throw new TikTokLiveUnavailableError(
      "The live probe lane is not configured — set APIFY_API_KEY (see .env.example).",
      503
    );
  }
  const actorId = process.env.APIFY_LIVE_ACTOR_ID || DEFAULT_ACTOR_ID;
  const transport = tiktokLiveProbeFetch();
  try {
    // rung 1 — run (the input body IS the contract: without it the actor
    // runs its own default handle and the dataset answers for the wrong
    // creator — the sandbox walk caught exactly that)
    const runUrl = `https://api.apify.com/v2/acts/${actorId}/runs?token=${encodeURIComponent(apiKey)}&timeout=${PROBE_TIMEOUT_SECS}`;
    const runRes = await transport(runUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handles: [key] }),
    });
    if (!runRes.ok) {
      throw new TikTokLiveUnavailableError(`TikTok live probe could not start (actor ${actorId}).`, 502);
    }
    const runBody = (await readJson(runRes)) as { data?: { id?: string; defaultDatasetId?: string } } | null;
    const runId = runBody?.data?.id;
    const datasetId = runBody?.data?.defaultDatasetId;
    if (!runId || !datasetId) {
      throw new TikTokLiveUnavailableError("TikTok live probe returned no run id.", 502);
    }
    // rung 2 — poll (capped)
    let succeeded = false;
    for (let attempt = 0; attempt < pollMaxAttempts; attempt += 1) {
      await sleep(pollIntervalMs);
      const pollRes = await transport(
        `https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(apiKey)}`
      );
      const pollBody = (await readJson(pollRes)) as { data?: { status?: string } } | null;
      const status = pollBody?.data?.status;
      if (status === "SUCCEEDED") {
        succeeded = true;
        break;
      }
      if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
        throw new TikTokLiveUnavailableError("TikTok live probe run failed upstream.", 502);
      }
    }
    if (!succeeded) {
      throw new TikTokLiveUnavailableError("TikTok live probe run did not finish in time.", 502);
    }
    // rung 3 — dataset
    const itemsRes = await transport(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${encodeURIComponent(apiKey)}`
    );
    if (!itemsRes.ok) {
      throw new TikTokLiveUnavailableError("TikTok live probe dataset could not be read.", 502);
    }
    const items = (await readJson(itemsRes)) as unknown;
    if (!Array.isArray(items)) {
      throw new TikTokLiveUnavailableError("TikTok live probe dataset was not a row list.", 502);
    }
    for (const row of items) {
      const dto = mapApifyLiveRow(row, key);
      if (dto) {
        cacheStatus(dto);
        return dto;
      }
    }
    throw new TikTokLiveUnavailableError(
      `TikTok live probe returned no row for @${key}.`,
      502
    );
  } catch (err) {
    // the failure-backoff law: one probe failure earns a 60s rest, and peek
    // surfaces the REAL error during that window
    const status = err instanceof TikTokLiveUnavailableError ? err.status : 502;
    const message = err instanceof Error ? err.message : "TikTok live probe failed.";
    backoff.set(key, { status, message, until: Date.now() + 60_000 });
    throw err;
  }
}
