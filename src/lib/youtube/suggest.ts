/**
 * WFX2-A-B search autocomplete — suggestqueries JSONP → clean array.
 *
 * Verified endpoint (research log §13 + tests/fixtures/yt/autocomplete_lofi.json):
 * GET https://suggestqueries-clients6.youtube.com/complete/search
 *     ?client=youtube&ds=yt&q=…
 * The body is JSONP: `window.google.ac.h(["lofi hi",[[ "lofi hip hop",0,…],…],{"k":1}])`
 * → strip the wrapper, parse, take [1][*][0].
 */
import { upstreamFetch } from "./upstream";
import { BROWSER_UA } from "./innertube";

const SUGGEST_URL = "https://suggestqueries-clients6.youtube.com/complete/search";

const JSONP_RE = /^[\w$.]+\s*\(([\s\S]*)\)\s*;?$/;

/** Pure: JSONP body → suggestion strings (empty when unparsable). */
export function parseAutocomplete(body: string): string[] {
  const m = JSONP_RE.exec(body.trim());
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[1]);
    if (!Array.isArray(parsed) || !Array.isArray(parsed[1])) return [];
    return parsed[1]
      .map((entry: unknown) => (Array.isArray(entry) ? entry[0] : null))
      .filter((s): s is string => typeof s === "string" && s.length > 0);
  } catch {
    return [];
  }
}

/** Fetch suggestions for a query prefix (public, no cookies needed). */
export async function autocomplete(query: string, opts: { timeoutMs?: number } = {}): Promise<string[]> {
  const url = `${SUGGEST_URL}?client=youtube&ds=yt&hl=en&gl=US&q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 6_000);
  try {
    const res = await upstreamFetch()(url, {
      method: "GET",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.youtube.com/",
      },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    return parseAutocomplete(await res.text());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
