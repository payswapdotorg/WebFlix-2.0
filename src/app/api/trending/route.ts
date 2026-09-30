import { NextResponse } from "next/server";
import { normalizeTrendingCategory, getTrendingPage } from "@/lib/youtube/trending-categories";
import { rateLimit } from "@/lib/youtube/cache";
import type { TrendingPageDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/trending?category=Now|Music|Gaming|Movies — the real youtube.com
 * trending categories. Mechanism (WFX2-B-W): SSR parse of the category page
 * (`/feed/trending` + its semantic category paths; `?bp=` chip params when
 * the live page's own chip navigation carries them). The browse XHR for
 * trending is rejected server-side (research log §5) — SSR is the mechanism.
 * Public mode: /feed/trending redirects to the What-to-Watch nudge (probed
 * live) → the rail fills with real search-backed popular-this-week videos;
 * `source` in the response says which path produced it.
 */
export async function GET(req: Request) {
  try {
    if (!(await rateLimit(`trending:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const category = normalizeTrendingCategory(new URL(req.url).searchParams.get("category"));
    const page = await getTrendingPage(category);
    const data: TrendingPageDTO = {
      category: page.category,
      videos: page.videos,
      source: page.source,
    };
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/trending failed", err);
    return NextResponse.json({ error: "Failed to load trending" }, { status: 502 });
  }
}
