import type { StreamFormatDto } from "@/lib/watch/types";

/**
 * P31-HPV5 — the shared googlevideo proxy surface. The helpers lived as
 * private copies inside /api/stream's route since Task 2-c; the playback
 * route's new stream mode needs the EXACT same laws (allowlist, plain-fetch
 * shape, header passthrough, anti-sniff CSP), so they move here — one
 * canonical home, both routes import. Behavior is byte-identical to the
 * Task 2-c / P29 laws (the /api/stream battery pins them there).
 *
 * Laws kept:
 *  - ALLOWLIST: https + *.googlevideo.com only (never a generic proxy);
 *  - `Range` forwarded (seek support), upstream 206/200 +
 *    content-type/-length/-range + accept-ranges passed through verbatim;
 *  - redirects followed (the CDN bounces between hosts);
 *  - a same-origin proxy must never let the browser sniff something else
 *    (CSP default-src 'none'; media-src 'self' + nosniff).
 */

const ALLOWED_HOST_SUFFIX = ".googlevideo.com";

/** Only https googlevideo videoplayback URLs can be proxied (allowlist law). */
export function isAllowedStreamUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (!host.endsWith(ALLOWED_HOST_SUFFIX) && host !== "googlevideo.com") return null;
  return url;
}

const PASSTHROUGH_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "cache-control",
] as const;

/**
 * One upstream attempt — the plain-fetch law googlevideo expects.
 *
 * WFX2-P37 — THE HEADER-DEADLINE LAW (the production 504 cure): the abort
 * clock applies ONLY until the upstream's response HEADERS arrive; once
 * they have, the timer is cleared and the BODY may stream for as long as
 * the invocation lives. The pre-P37 `AbortSignal.timeout(60_000)` shape had
 * two measured production defects: (a) it raced the route's own
 * `maxDuration = 60` and LOST — a tarpitting googlevideo connection (no
 * headers, no RST — the datacenter-IP punishment class) held the fetch
 * until the PLATFORM killed the invocation, answering the client a 504 the
 * route never chose (measured 2026-10-22: 4/4 stream-mode 504s, every one
 * a chain that never reached its own honest 502); and (b) on the rare
 * answering upstream it killed long bodies MID-TRANSFER at the 60s mark.
 * A healthy googlevideo answers headers in well under a second; 8s is the
 * honest "this connection will never answer" verdict, and the caller's
 * honest floor (502 → the client's embed fallback ladder) takes over.
 */
export async function fetchUpstream(
  upstreamUrl: URL,
  range: string | null,
  headerDeadlineMs = 8_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), headerDeadlineMs);
  try {
    const res = await fetch(upstreamUrl, {
      redirect: "follow",
      headers: {
        // googlevideo requires noReferer-ish plain fetches; a Range when present
        ...(range ? { Range: range } : {}),
        Accept: "*/*",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    return res; // headers are in — the timer dies in finally, the body streams
  } finally {
    clearTimeout(timer);
  }
}

/** A usable upstream answer: 200 or 206 (partial content). */
export function isUsable(upstream: Response): boolean {
  return upstream.ok || upstream.status === 206;
}

/** Wrap an upstream answer for same-origin streaming (header + CSP law). */
export function streamOut(upstream: Response): Response {
  const headers = new Headers();
  for (const name of PASSTHROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // a same-origin proxy must never let the browser sniff something else
  headers.set("content-security-policy", "default-src 'none'; media-src 'self'");
  headers.set("x-content-type-options", "nosniff");
  return new Response(upstream.body, { status: upstream.status, headers });
}

/**
 * Attempt ONE playback-chain-backed stream: pick the format (prefer the
 * client's itag), fetch it from THIS invocation's egress. Returns the usable
 * upstream response, or null when the chain yielded no usable format or the
 * upstream answered dead (the caller decides the fallback / honest floor).
 *
 * P31-HPV5 — the shared attempt loop behind the playback route's stream
 * mode: generate-and-fetch must ride ONE invocation (the measured 2026-10-20
 * production truth: the client-held URL is IP-bound to a different
 * function's egress, and the legacy stream route's own egress cannot run
 * the playback chain at all — the regen's 11/11 fast-502s).
 *
 * P32-HPV6 — THE MULTI-FORMAT TICKET LOOP: the first ticket is still the
 * picker's own answer (the same-itag Range-resume law — a resume must ride
 * the same stream), but a dead answer no longer ends the attempt: up to
 * MAX_STREAM_TICKETS distinct-itag candidates run in the picker's own
 * preference order (each pick re-applied to the remaining pool, so ticket 2
 * is the next-best nearest-360p law answer, not an arbitrary leftover).
 * The wall is a per-(video, client, egress, FORMAT) lottery — the moving
 * wall measured 2026-10-20/21 can kill one googlevideo URL while a sibling
 * format's URL (often a different CDN host) still serves; a dead answer
 * costs one FAST request, so extra tickets are cheap lottery seats in the
 * chain's own idiom. The route rides this loop only on the FRESH chain
 * (attempt 2) — a cached generation's URLs are dead TOGETHER (same egress,
 * same instant), so the cached attempt stays the single pick it was.
 */
export const MAX_STREAM_TICKETS = 3;

export async function attemptChainStream(
  formats: StreamFormatDto[],
  preferItag: number | null,
  range: string | null,
  pick: (formats: StreamFormatDto[], preferItag: number | null) => StreamFormatDto | null,
  headerDeadlineMs = 8_000
): Promise<Response | null> {
  if (formats.length === 0) return null; // the walled class — no honest stream to serve
  const pool = [...formats];
  for (let ticket = 0; ticket < MAX_STREAM_TICKETS && pool.length > 0; ticket++) {
    const fmt = pick(pool, ticket === 0 ? preferItag : null);
    if (!fmt) break;
    pool.splice(pool.indexOf(fmt), 1);
    const url = isAllowedStreamUrl(fmt.url);
    if (!url) continue; // structurally impossible (our own chain) — the next ticket
    try {
      const res = await fetchUpstream(url, range, headerDeadlineMs);
      if (isUsable(res)) return res;
    } catch {
      /* dead — the next ticket */
    }
  }
  return null;
}
