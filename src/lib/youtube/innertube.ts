/**
 * WFX2-A-B InnerTube client — the typed read layer over
 * `https://www.youtube.com/youtubei/v1/<endpoint>`.
 *
 * Verified against live youtube.com (see docs/research/2026-09-29-verifications.md):
 * search / browse / next / reel/reel_watch_sequence / reel/reel_item_watch /
 * live_chat/get_live_chat / notification/get_notification_menu.
 *
 * The `player` endpoint: called ONLY from src/lib/youtube/streams.ts (Task
 * 2-c — the embed-wall playback fallback chain; watch METADATA still comes
 * from `next`). Egress reality: the sandbox IP is walled for every client
 * probed (LOGIN_REQUIRED/ERROR — verification §14, the historical
 * "OFF-LIMITS" finding, now an honest degrade instead of a ban); Vercel
 * egress is untested at build time. INNER_TUBE_PLAYER_CLIENT selects the
 * primary client (default WEB; streams.ts chains IOS as the second try).
 *
 * Body: plain (gzip-safe) JSON — responses may arrive gzip/br compressed and
 * the runtime fetch decompresses transparently.
 * Transport: browser-like headers + optional session cookie, request timeout,
 * and a single retry with jitter on network errors / 429 / 5xx.
 */
import { upstreamFetch, setUpstream, isTestUpstream, type UpstreamFetch } from "./upstream";
import { getCookieHeader } from "./session";

export { setUpstream, isTestUpstream };
export type { UpstreamFetch };

/** Public WEB InnerTube key (env-overridable). */
export const INNERTUBE_API_KEY =
  process.env.INNERTUBE_API_KEY ?? "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

export const INNERTUBE_BASE = "https://www.youtube.com/youtubei/v1";

export const WEB_CLIENT = {
  clientName: "WEB",
  clientVersion: "2.20260925.08.00",
  hl: "en",
  gl: "US",
} as const;

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** The captured context shape (tests/fixtures/yt/request_payload_examples.json). */
export function innerTubeContext(): Record<string, unknown> {
  return { context: { client: { ...WEB_CLIENT } } };
}

export function innerTubeHeaders(cookies?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": BROWSER_UA,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: "https://www.youtube.com",
    Referer: "https://www.youtube.com/",
    "X-Origin": "https://www.youtube.com",
    "X-Youtube-Client-Name": "1",
    "X-Youtube-Client-Version": WEB_CLIENT.clientVersion,
  };
  const cookie = cookies !== undefined ? cookies : getCookieHeader();
  if (cookie) headers.Cookie = cookie;
  return headers;
}

export class InnertubeError extends Error {
  status: number;
  endpoint: string;
  constructor(endpoint: string, status: number, message: string) {
    super(`youtubei/${endpoint} ${status}: ${message}`);
    this.name = "InnertubeError";
    this.endpoint = endpoint;
    this.status = status;
  }
}

export interface InnertubeOptions {
  /** Override session cookies (undefined → env session; null → force public). */
  cookies?: string | null;
  timeoutMs?: number;
  /** Extra retries beyond the built-in single retry (default 0). */
  extraRetries?: number;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

function jitterDelayMs(): number {
  return 200 + Math.random() * 400;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST an InnerTube request. `endpoint` is the path after `/youtubei/v1/`
 * (e.g. "search", "browse", "next", "player" — the last via streams.ts
 * only — "reel/reel_watch_sequence", "live_chat/get_live_chat",
 * "notification/get_notification_menu").
 * Responses are loosely typed at this layer (`Record<string, any>`); the
 * mapper layer owns the strong types.
 */
export async function innertube<T = Record<string, any>>(
  endpoint: string,
  body: Record<string, unknown>,
  opts: InnertubeOptions = {}
): Promise<T> {
  const url = `${INNERTUBE_BASE}/${endpoint}?key=${encodeURIComponent(INNERTUBE_API_KEY)}&prettyPrint=false`;
  const payload = JSON.stringify({ ...innerTubeContext(), ...body });
  const headers = innerTubeHeaders(opts.cookies);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts = 1 + 1 + (opts.extraRetries ?? 0); // initial + single retry (+ extras)

  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(jitterDelayMs());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onOuterAbort, { once: true });
    try {
      const res = await upstreamFetch()(url, {
        method: "POST",
        headers,
        body: payload,
        signal: opts.signal ?? controller.signal,
      });
      if (RETRY_STATUS.has(res.status) && attempt < attempts - 1) {
        lastError = new InnertubeError(endpoint, res.status, `retryable status ${res.status}`);
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new InnertubeError(endpoint, res.status, text.slice(0, 300) || `HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      // a caller-owned abort is not retryable
      if (opts.signal?.aborted) throw err;
      lastError = err;
      if (attempt === attempts - 1) throw err;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onOuterAbort);
    }
  }
  throw lastError ?? new InnertubeError(endpoint, 0, "unreachable");
}

/** Convenience wrappers for the endpoints this lane uses. */
export const innertubeSearch = (body: Record<string, unknown>, opts?: InnertubeOptions) =>
  innertube("search", body, opts);
export const innertubeBrowse = (body: Record<string, unknown>, opts?: InnertubeOptions) =>
  innertube("browse", body, opts);
export const innertubeNext = (body: Record<string, unknown>, opts?: InnertubeOptions) =>
  innertube("next", body, opts);
