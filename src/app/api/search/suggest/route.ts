import { NextResponse } from "next/server";
import { autocomplete } from "@/lib/youtube/suggest";
import { cached, TTL, rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/search/suggest?q= — suggestqueries autocomplete (JSONP body →
 * clean string array). Public endpoint, cached per prefix.
 */
export async function GET(req: Request) {
  try {
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
    if (!q) return NextResponse.json({ query: q, suggestions: [] });
    if (!rateLimit(`suggest:${req.headers.get("x-forwarded-for") ?? "local"}`, { limit: 240 })) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const suggestions = await cached(`yt:suggest:${q.toLowerCase()}`, TTL.SUGGEST_MS, () =>
      autocomplete(q)
    );
    return NextResponse.json({ query: q, suggestions });
  } catch (err) {
    console.error("GET /api/search/suggest failed", err);
    return NextResponse.json({ query: "", suggestions: [] });
  }
}
