import { NextResponse } from "next/server";
import { autocomplete } from "@/lib/youtube/suggest";
import { cached, TTL, rateLimit } from "@/lib/youtube/cache";
import { suggestNetflixTitles } from "@/lib/netflix/catalog";
import type { NetflixCatalogSuggestion } from "@/lib/netflix/types";

export const dynamic = "force-dynamic";

/** P3-SG lane law: 5s upstream timeout — a slow suggest never blocks the box. */
export const SUGGEST_TIMEOUT_MS = 5_000;

/**
 * GET /api/search/suggest?q= — suggestqueries autocomplete (JSONP body →
 * clean string array). Public endpoint, cached per prefix.
 *
 * P49 — the Netflix lane is ADDITIVE: the `suggestions` array keeps its
 * exact P3 contract (string[]), and a `netflix` array rides beside it —
 * up to three scored mirror matches ({netflixId, title, releaseYear, kind})
 * that the dropdown renders as badge rows navigating straight to the title
 * page. The mirror lookup is fresh per request (cheap, and the currently-
 * ranking titles stay first), wrapped so Netflix trouble can never delay
 * or break the YouTube suggest.
 */
export async function GET(req: Request) {
  try {
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
    if (!q) return NextResponse.json({ query: q, suggestions: [], netflix: [] });
    if (!(await rateLimit(`suggest:${req.headers.get("x-forwarded-for") ?? "local"}`, { limit: 240 }))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const suggestions = await cached(`yt:suggest:${q.toLowerCase()}`, TTL.SUGGEST_MS, () =>
      autocomplete(q, { timeoutMs: SUGGEST_TIMEOUT_MS })
    );
    const netflix: NetflixCatalogSuggestion[] = await suggestNetflixTitles(q, 3);
    return NextResponse.json({ query: q, suggestions, netflix });
  } catch (err) {
    console.error("GET /api/search/suggest failed", err);
    return NextResponse.json({ query: "", suggestions: [], netflix: [] });
  }
}
