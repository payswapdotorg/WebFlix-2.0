/**
 * WFX2-A-B SSR layer — fetch youtube.com pages and extract `ytInitialData`.
 *
 * The extraction regex is the one verified in the research log
 * (verifications §15 / ground rule 6): `var ytInitialData = ({...});</script>`.
 * YouTube never emits a literal `</script>` inside the JSON (it escapes the
 * slash), so the lazy match is safe.
 */
import { upstreamFetch } from "./upstream";
import { BROWSER_UA } from "./innertube";
import { getCookieHeader } from "./session";

export const YT_BASE = "https://www.youtube.com";

export const YT_INITIAL_DATA_RE = /var ytInitialData = ({[\s\S]*?});<\/script>/;

/** Pure extractor (exported for fixture-driven tests). */
export function extractYtInitialData(html: string): Record<string, any> {
  const m = html.match(YT_INITIAL_DATA_RE);
  if (!m) throw new Error("ytInitialData not found in page HTML");
  return JSON.parse(m[1]) as Record<string, any>;
}

export function ssrHeaders(cookies?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": BROWSER_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://www.youtube.com/",
  };
  const cookie = cookies !== undefined ? cookies : getCookieHeader();
  if (cookie) headers.Cookie = cookie;
  return headers;
}

/**
 * GET `https://www.youtube.com<path>` (with session cookies when present) and
 * return the parsed `ytInitialData`. `path` must start with "/".
 */
export async function fetchYtInitialData(
  path: string,
  opts: { cookies?: string | null; timeoutMs?: number } = {}
): Promise<Record<string, any>> {
  if (!path.startsWith("/")) throw new Error(`ssr path must start with "/": ${path}`);
  const url = `${YT_BASE}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12_000);
  try {
    const res = await upstreamFetch()(url, {
      method: "GET",
      headers: ssrHeaders(opts.cookies),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`SSR fetch ${path} failed: HTTP ${res.status}`);
    }
    return extractYtInitialData(await res.text());
  } finally {
    clearTimeout(timer);
  }
}
