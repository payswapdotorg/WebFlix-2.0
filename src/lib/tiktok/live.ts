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
// The clock seam (P102-R2): every TTL/cache decision rides this function so
// tests can step the clock deterministically (prod rides Date.now). The
// fetchedAt timestamps keep new Date() — they are REAL timestamps.
// ---------------------------------------------------------------------------
let nowMs: () => number = () => Date.now();

/** Test hook: null restores the real clock. */
export function setTikTokLiveClock(fn: (() => number) | null): void {
  nowMs = fn ?? (() => Date.now());
}

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
  /** The live room id (P102 playback rows carry it; the webcast refresh residual's key). */
  roomId?: string | null;
}

/** The status DTO every live surface consumes. */
export interface TikTokLiveStatusDTO {
  handle: string;
  /** null = unknown (probe in flight) — never render that as offline. */
  live: boolean | null;
  probing?: boolean;
  room: TikTokLiveRoomInfo | null;
  stream: TikTokLiveStreamInfo | null;
  /** P102: true while the playback resolution is in flight for a live room
   * (the view shows "resolving the stream…", never the fallback rung). */
  streamProbing?: boolean;
  /** P102-R2 (the SWR law): true when the answer served is the LAST KNOWN
   * one while a refresh probe rides after() — fetchedAt carries the age. A
   * stale answer never flips a mounted room to probing. */
  stale?: boolean;
  source: "apify" | "webcast" | "";
  fetchedAt: string;
}

/** The live-board DTO (P102 G27): one honest answer for the whole universe. */
export interface TikTokLiveBoardDTO {
  rooms: TikTokLiveStatusDTO[];
  /** Requested handles the provider returned no row for — answered, not faked. */
  missing: string[];
  probing?: boolean;
  /** P102-R2 (the SWR law): the LAST KNOWN board while a refresh rides. */
  stale?: boolean;
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

/** The playback cache TTL (P102 cost law): a signed stream URL outlives the
 * room's 30s status cache, but rooms change — 120s is the honest re-probe
 * cadence, and the player's error → fallback rung covers any mid-watch
 * expiry. */
export const TIKTOK_LIVE_PLAYBACK_TTL_MS = 120_000;

/** The board cap (the feed-page cap class): the universe poll never grows
 * unbounded; extra handles are dropped deterministically. */
export const TIKTOK_LIVE_BOARD_CAP = 60;

/**
 * P102-R4 — the pinned live universe: the feed curates POSTS (the rail) but
 * the live lane tracks CREATORS. Measured on prod: a rail-only universe
 * never requested lofigirl — the operator's canonical live creator was
 * uncheckable by construction. The pin list rides the SAME batched board
 * run (zero extra spend). `TIKTOK_LIVE_PINNED_HANDLES` (comma-separated
 * handles) REPLACES the default when set (the curatedPostIds precedent);
 * every entry rides the URL law's normalize+validate, garbage drops.
 */
export const TIKTOK_LIVE_PINNED_DEFAULT: readonly string[] = ["lofigirl"];

export function tiktokLivePinnedHandles(
  env: Record<string, string | undefined> = process.env
): string[] {
  const raw = (env.TIKTOK_LIVE_PINNED_HANDLES ?? "").trim();
  const list = raw ? raw.split(",") : [...TIKTOK_LIVE_PINNED_DEFAULT];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of list) {
    const key = normalizeTikTokHandle(part ?? "");
    if (!key || !isTikTokHandle(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
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
  playbackCache.clear();
  playbackBackoff.clear();
  playbackInFlight.clear();
  boardCache.clear();
  boardInFlight.clear();
}

/** True while a probe for `handle` is in flight (route coalescing). */
export function isTikTokLiveProbeInFlight(handle: string): boolean {
  return inFlight.has(normalizeTikTokHandle(handle));
}

/** True while the handle's lane rests in its 60s failure backoff. */
export function isTikTokLiveProbeBackedOff(handle: string): boolean {
  const marker = backoff.get(normalizeTikTokHandle(handle));
  return Boolean(marker && marker.until > nowMs());
}

/** Cache-only read. Throws the REAL error while a handle is in backoff. */
export async function peekTikTokLiveStatus(handle: string): Promise<TikTokLiveStatusDTO | null> {
  const key = normalizeTikTokHandle(handle);
  if (!key || !isTikTokHandle(key)) return null;
  const marker = backoff.get(key);
  if (marker && marker.until > nowMs()) {
    throw new TikTokLiveUnavailableError(marker.message, marker.status);
  }
  if (marker) backoff.delete(key);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > nowMs()) return hit.dto;
  if (hit) cache.delete(key);
  return null;
}

function cacheStatus(dto: TikTokLiveStatusDTO): void {
  cache.set(dto.handle, { dto, expiresAt: nowMs() + liveStatusTtlMs(dto) });
}

/**
 * P102-R2 — the SWR read: fresh AND stale entries. A warm room NEVER goes
 * dark: an expired-but-present entry is returned with `fresh: false` so the
 * route serves it (marked `stale: true` — fetchedAt carries the age) while
 * the refresh probe rides after(). Only a COLD handle answers probing. The
 * backoff error fires only when NO entry exists — last-known data beats a
 * mid-watch error, and the backoff still gates the refresh cadence.
 */
export function readTikTokLiveStatusEntry(
  handle: string
): { dto: TikTokLiveStatusDTO; fresh: boolean } | null {
  const key = normalizeTikTokHandle(handle);
  if (!key || !isTikTokHandle(key)) return null;
  const hit = cache.get(key);
  if (hit) return { dto: hit.dto, fresh: hit.expiresAt > nowMs() };
  const marker = backoff.get(key);
  if (marker && marker.until > nowMs()) {
    throw new TikTokLiveUnavailableError(marker.message, marker.status);
  }
  if (marker) backoff.delete(key);
  return null;
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

/**
 * The shared actor state machine (P102 refactor of the P100 machine, its
 * contracts byte-identical): run → poll (capped) → dataset items. Every
 * failure is a typed Unavailable error; the transport is the injected
 * live-upstream seam (no network outside it, the lane law).
 */
async function runActorDataset(actorId: string, body: Record<string, unknown>): Promise<unknown[]> {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) {
    throw new TikTokLiveUnavailableError(
      "The live probe lane is not configured — set APIFY_API_KEY (see .env.example).",
      503
    );
  }
  const transport = tiktokLiveProbeFetch();
  // rung 1 — run (the input body IS the contract: without it the actor runs
  // its own default handle and the dataset answers for the wrong creator —
  // the P100 sandbox walk caught it and probe R3a re-measured the class on
  // the playback actor 4×)
  const runUrl = `https://api.apify.com/v2/acts/${actorId}/runs?token=${encodeURIComponent(apiKey)}&timeout=${PROBE_TIMEOUT_SECS}`;
  const runRes = await transport(runUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
  return items;
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
  try {
    const items = await runActorDataset(actorId, { handles: [key] });
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
    backoff.set(key, { status, message, until: nowMs() + 60_000 });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// P102 — the PLAYBACK provider (docs/research/2026-11-07-p102-live-playback-
// navigation-report.md, probes R3/R3a): the automation-lab stream-urls actor
// resolves the hls/flv CDN URLs the status actor never carries. The input
// contract is `{"usernames":[…]}` — measured live: `handle`, `username`,
// `users`, and `liveUrls` are all IGNORED by the actor and it resolves its
// hard-coded default creator (the R3a trap, 4×). The mapper's identity guard
// makes that class honest: a default-row answer resolves to "no row", never
// a wrong creator's stream.
// ---------------------------------------------------------------------------

const DEFAULT_PLAYBACK_ACTOR_ID = "automation-lab~tiktok-live-room-stream-urls";

/**
 * Map one playback-actor row to the stream info for `handle`. The identity
 * guard is the law: the row's `username` MUST equal the requested handle
 * (probe R3a showed the actor answering for its default creator when the
 * input key is wrong — a wrong stream is the one answer this lane may never
 * give). `isLive !== true` and any `resolutionError` answer null; the hls
 * url is selected by `format === "hls"` (not by a substring guess).
 */
export function mapApifyPlaybackRow(row: unknown, handle: string): TikTokLiveStreamInfo | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const username = typeof r.username === "string" ? r.username.toLowerCase() : null;
  if (!username || username !== handle.toLowerCase()) return null;
  if (r.isLive !== true) return null;
  if (typeof r.resolutionError === "string" && r.resolutionError.length > 0) return null;
  let hlsUrl: string | null = null;
  let flvUrl: string | null = null;
  if (Array.isArray(r.streamUrls)) {
    for (const entry of r.streamUrls) {
      if (!entry || typeof entry !== "object") continue;
      const s = entry as Record<string, unknown>;
      if (typeof s.url !== "string" || !s.url.startsWith("https://")) continue;
      if (s.format === "hls" && !hlsUrl) hlsUrl = s.url;
      if (s.format === "flv" && !flvUrl) flvUrl = s.url;
    }
  }
  if (!hlsUrl && !flvUrl) return null;
  return {
    hlsUrl,
    flvUrl,
    roomId: typeof r.roomId === "string" ? r.roomId : null,
  };
}

const globalForPlayback = globalThis as unknown as {
  __wfx2TikTokPlaybackCache?: Map<string, { stream: TikTokLiveStreamInfo; expiresAt: number }>;
  __wfx2TikTokPlaybackBackoff?: Map<string, { status: number; message: string; until: number }>;
  __wfx2TikTokPlaybackInFlight?: Map<string, Promise<TikTokLiveStreamInfo | null>>;
};

const playbackCache: Map<string, { stream: TikTokLiveStreamInfo; expiresAt: number }> =
  globalForPlayback.__wfx2TikTokPlaybackCache ?? new Map();
globalForPlayback.__wfx2TikTokPlaybackCache = playbackCache;

const playbackBackoff: Map<string, { status: number; message: string; until: number }> =
  globalForPlayback.__wfx2TikTokPlaybackBackoff ?? new Map();
globalForPlayback.__wfx2TikTokPlaybackBackoff = playbackBackoff;

const playbackInFlight: Map<string, Promise<TikTokLiveStreamInfo | null>> =
  globalForPlayback.__wfx2TikTokPlaybackInFlight ?? new Map();
globalForPlayback.__wfx2TikTokPlaybackInFlight = playbackInFlight;

/** True while a playback resolution for `handle` is in flight. */
export function isTikTokLivePlaybackInFlight(handle: string): boolean {
  return playbackInFlight.has(normalizeTikTokHandle(handle));
}

/** True while the playback lane rests in its 60s failure backoff. */
export function isTikTokLivePlaybackBackedOff(handle: string): boolean {
  const marker = playbackBackoff.get(normalizeTikTokHandle(handle));
  return Boolean(marker && marker.until > nowMs());
}

/** Cache-only playback read. Throws the REAL error while in backoff. */
export async function peekTikTokLivePlayback(handle: string): Promise<TikTokLiveStreamInfo | null> {
  const key = normalizeTikTokHandle(handle);
  if (!key || !isTikTokHandle(key)) return null;
  const marker = playbackBackoff.get(key);
  if (marker && marker.until > nowMs()) {
    throw new TikTokLiveUnavailableError(marker.message, marker.status);
  }
  if (marker) playbackBackoff.delete(key);
  const hit = playbackCache.get(key);
  if (hit && hit.expiresAt > nowMs()) return hit.stream;
  if (hit) playbackCache.delete(key);
  return null;
}

/**
 * P102-R2 — the SWR read for the playback lane: a stale-but-present stream
 * answer keeps the video mounted while the refresh rides after(); the
 * player's own error → fallback rung covers a genuinely dead URL. The
 * backoff error fires only when NO answer exists.
 */
export function readTikTokLivePlaybackEntry(
  handle: string
): { stream: TikTokLiveStreamInfo; fresh: boolean } | null {
  const key = normalizeTikTokHandle(handle);
  if (!key || !isTikTokHandle(key)) return null;
  const hit = playbackCache.get(key);
  if (hit) return { stream: hit.stream, fresh: hit.expiresAt > nowMs() };
  const marker = playbackBackoff.get(key);
  if (marker && marker.until > nowMs()) {
    throw new TikTokLiveUnavailableError(marker.message, marker.status);
  }
  if (marker) playbackBackoff.delete(key);
  return null;
}

/**
 * Resolve the playback stream for a LIVE room. The route composes this ONLY
 * after a live status (the cost law: an offline room never spends a playback
 * probe). Same machine discipline: one run per handle per process, capped
 * polling, honest backoff.
 */
export async function probeTikTokLivePlayback(handle: string): Promise<TikTokLiveStreamInfo | null> {
  const key = normalizeTikTokHandle(handle);
  if (!key || !isTikTokHandle(key)) return null;
  const existing = playbackInFlight.get(key);
  if (existing) return existing;
  const pending = runPlaybackProbe(key).finally(() => playbackInFlight.delete(key));
  playbackInFlight.set(key, pending);
  return pending;
}

async function runPlaybackProbe(key: string): Promise<TikTokLiveStreamInfo> {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) {
    throw new TikTokLiveUnavailableError(
      "The live probe lane is not configured — set APIFY_API_KEY (see .env.example).",
      503
    );
  }
  const actorId = process.env.APIFY_LIVE_STREAM_ACTOR_ID || DEFAULT_PLAYBACK_ACTOR_ID;
  try {
    const items = await runActorDataset(actorId, { usernames: [key] });
    for (const row of items) {
      const stream = mapApifyPlaybackRow(row, key);
      if (stream) {
        playbackCache.set(key, { stream, expiresAt: nowMs() + TIKTOK_LIVE_PLAYBACK_TTL_MS });
        return stream;
      }
    }
    throw new TikTokLiveUnavailableError(
      `TikTok live playback returned no stream for @${key}.`,
      502
    );
  } catch (err) {
    const status = err instanceof TikTokLiveUnavailableError ? err.status : 502;
    const message = err instanceof Error ? err.message : "TikTok live playback failed.";
    playbackBackoff.set(key, { status, message, until: nowMs() + 60_000 });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// P102 — the live BOARD (G27): the honest navigation closure. ONE batched
// status run answers the whole tracked universe (the status actor's native
// `{"handles":[…]}` mode); rows are matched to handles by identity; missing
// rows are answered honestly; the per-handle answers ride the SAME status
// cache the single-handle lane reads, so the board feeds every surface.
// ---------------------------------------------------------------------------

/** Normalize → validate → dedupe → cap a requested handle list. */
export function normalizeBoardHandles(handles: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of handles) {
    const key = normalizeTikTokHandle(raw ?? "");
    if (!key || !isTikTokHandle(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= TIKTOK_LIVE_BOARD_CAP) break;
  }
  return out;
}

const globalForBoard = globalThis as unknown as {
  __wfx2TikTokBoardCache?: Map<string, { board: TikTokLiveBoardDTO; expiresAt: number }>;
  __wfx2TikTokBoardInFlight?: Map<string, Promise<TikTokLiveBoardDTO>>;
};

const boardCache: Map<string, { board: TikTokLiveBoardDTO; expiresAt: number }> =
  globalForBoard.__wfx2TikTokBoardCache ?? new Map();
globalForBoard.__wfx2TikTokBoardCache = boardCache;

const boardInFlight: Map<string, Promise<TikTokLiveBoardDTO>> =
  globalForBoard.__wfx2TikTokBoardInFlight ?? new Map();
globalForBoard.__wfx2TikTokBoardInFlight = boardInFlight;

function boardKey(handles: string[]): string {
  return [...handles].sort().join(",");
}

/** The board TTL rides the liveness law: any live room → 30s, else 300s. */
function boardTtlMs(board: TikTokLiveBoardDTO): number {
  const anyLive = board.rooms.some((r) => r.live === true);
  return anyLive ? 30_000 : 300_000;
}

/** True while a board probe for this exact handle set is in flight. */
export function isTikTokLiveBoardInFlight(handles: string[]): boolean {
  const keys = normalizeBoardHandles(handles);
  return boardInFlight.has(boardKey(keys));
}

/** Cache-only board read. */
export async function peekTikTokLiveBoard(handles: string[]): Promise<TikTokLiveBoardDTO | null> {
  const keys = normalizeBoardHandles(handles);
  if (keys.length === 0) return null;
  const hit = boardCache.get(boardKey(keys));
  if (hit && hit.expiresAt > nowMs()) return hit.board;
  if (hit) boardCache.delete(boardKey(keys));
  return null;
}

/**
 * P102-R2 — the SWR read for the board: a stale-but-present board keeps the
 * hub mounted while the refresh rides after(). (The board lane has no
 * backoff map: a failed batch run clears its in-flight marker and the next
 * request re-probes — one run per universe, TTL-gated.)
 */
export function readTikTokLiveBoardEntry(handles: string[]): { board: TikTokLiveBoardDTO; fresh: boolean } | null {
  const keys = normalizeBoardHandles(handles);
  if (keys.length === 0) return null;
  const hit = boardCache.get(boardKey(keys));
  if (hit) return { board: hit.board, fresh: hit.expiresAt > nowMs() };
  return null;
}

/**
 * P102-R3 — the merge law: the batch actor EMPIRICALLY DROPS rows (measured
 * on prod this window: one batched run answered 5 of 16 handles — a creator
 * live at 193 viewers landed in `missing` while the single-handle lane
 * proved her live). The SERVED board folds in FRESH live answers the
 * per-handle status cache already holds: every merged row is a real probe's
 * answer and the cost law adds zero spend. A STALE answer never claims
 * liveness on the hub (fresh-only); an OFFLINE answer never renders as a
 * room; handles with nothing to fold stay honestly in `missing`.
 */
export function mergeTikTokLiveBoard(board: TikTokLiveBoardDTO): TikTokLiveBoardDTO {
  const present = new Set(board.rooms.map((r) => r.handle));
  const merged: TikTokLiveStatusDTO[] = [...board.rooms];
  const missing: string[] = [];
  for (const handle of board.missing) {
    let folded = false;
    try {
      const entry = readTikTokLiveStatusEntry(handle);
      if (entry?.fresh && entry.dto.live === true && !present.has(handle)) {
        merged.push(entry.dto);
        folded = true;
      }
    } catch {
      // the lane rests in backoff for this handle — it stays missing
    }
    if (!folded) missing.push(handle);
  }
  return { ...board, rooms: merged, missing };
}

/**
 * Probe the whole handle set with ONE actor run. Invalid handles are
 * dropped before the run (no cents spent on garbage); rows are matched by
 * identity (the mapper's guard); requested handles with no row land in
 * `missing` — answered, not faked.
 */
export async function probeTikTokLiveBoard(handles: string[]): Promise<TikTokLiveBoardDTO> {
  const keys = normalizeBoardHandles(handles);
  if (keys.length === 0) {
    return { rooms: [], missing: [], fetchedAt: new Date().toISOString() };
  }
  const key = boardKey(keys);
  const existing = boardInFlight.get(key);
  if (existing) return existing;
  const pending = runBoardProbe(keys, key).finally(() => boardInFlight.delete(key));
  boardInFlight.set(key, pending);
  return pending;
}

async function runBoardProbe(keys: string[], key: string): Promise<TikTokLiveBoardDTO> {
  const apiKey = process.env.APIFY_API_KEY;
  if (!apiKey) {
    throw new TikTokLiveUnavailableError(
      "The live probe lane is not configured — set APIFY_API_KEY (see .env.example).",
      503
    );
  }
  const actorId = process.env.APIFY_LIVE_ACTOR_ID || DEFAULT_ACTOR_ID;
  const items = await runActorDataset(actorId, { handles: keys });
  const remaining = new Set(keys);
  const rooms: TikTokLiveStatusDTO[] = [];
  for (const row of items) {
    if (remaining.size === 0) break;
    for (const candidate of [...remaining]) {
      const dto = mapApifyLiveRow(row, candidate);
      if (dto) {
        rooms.push(dto);
        cacheStatus(dto);
        remaining.delete(candidate);
        break;
      }
    }
  }
  const board: TikTokLiveBoardDTO = {
    rooms,
    missing: [...remaining],
    fetchedAt: new Date().toISOString(),
  };
  boardCache.set(key, { board, expiresAt: nowMs() + boardTtlMs(board) });
  return board;
}
