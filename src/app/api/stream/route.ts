import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Task 2-c — GET /api/stream?url=<encoded googlevideo URL>
 *
 * The local proxy for the embed-wall fallback's native <video> swap.
 * googlevideo.com videoplayback URLs are IP-bound (they only play from the
 * egress that fetched them — the server), so the browser can never fetch
 * them directly. This route streams them same-origin:
 *  - ALLOWLIST: https + *.googlevideo.com only (never a generic proxy);
 *  - `Range` request header is forwarded (seek support) and the upstream
 *    206/200 + content-type/-length/-range + accept-ranges are passed
 *    through verbatim;
 *  - redirects followed (the CDN bounces between hosts);
 *  - 60s budget — enough to start + serve a progressive segment; the
 *    player retries its own Range requests as needed.
 */
const ALLOWED_HOST_SUFFIX = ".googlevideo.com";

function isAllowedStreamUrl(raw: string): URL | null {
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

export async function GET(req: Request) {
  const target = new URL(req.url).searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }
  const upstreamUrl = isAllowedStreamUrl(target);
  if (!upstreamUrl) {
    return NextResponse.json(
      { error: "Only googlevideo.com stream URLs can be proxied" },
      { status: 400 }
    );
  }

  const range = req.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      redirect: "follow",
      headers: {
        // googlevideo requires noReferer-ish plain fetches; a Range when present
        ...(range ? { Range: range } : {}),
        Accept: "*/*",
      },
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "TimeoutError";
    return NextResponse.json(
      { error: aborted ? "Upstream stream timed out" : "Upstream stream failed" },
      { status: aborted ? 504 : 502 }
    );
  }

  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json(
      { error: `Upstream stream responded ${upstream.status}` },
      { status: 502 }
    );
  }

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
