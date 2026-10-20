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

/** One upstream attempt — the plain-fetch law googlevideo expects. */
export async function fetchUpstream(
  upstreamUrl: URL,
  range: string | null
): Promise<Response> {
  return fetch(upstreamUrl, {
    redirect: "follow",
    headers: {
      // googlevideo requires noReferer-ish plain fetches; a Range when present
      ...(range ? { Range: range } : {}),
      Accept: "*/*",
    },
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
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
 */
export async function attemptChainStream(
  formats: StreamFormatDto[],
  preferItag: number | null,
  range: string | null,
  pick: (formats: StreamFormatDto[], preferItag: number | null) => StreamFormatDto | null
): Promise<Response | null> {
  const fmt = pick(formats, preferItag);
  if (!fmt) return null; // the walled class — no honest stream to serve
  const url = isAllowedStreamUrl(fmt.url);
  if (!url) return null; // structurally impossible (our own chain) — belt and braces
  try {
    const res = await fetchUpstream(url, range);
    if (isUsable(res)) return res;
  } catch {
    /* honest fall-through */
  }
  return null;
}
