import { NextResponse } from "next/server";
import { normalizeTrendingCategory, getTrendingPage } from "@/lib/youtube/trending-categories";
import { normalizeTrendingRegion } from "@/lib/youtube/trending-regions";
import { rateLimit } from "@/lib/youtube/cache";
import type { TrendingPageDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/trending?category=Now|Music|Gaming|Movies&region=US|GB|… — the real
 * youtube.com trending categories, region-shaped (P23-C G7). Mechanism
 * (WFX2-B-W): SSR parse of the category page (`/feed/trending` + its semantic
 * category paths; `?bp=` chip params when the live page's own chip navigation
 * carries them). The browse XHR for trending is rejected server-side
 * (research log §5 — re-verified this lane) — SSR is the mechanism.
 * P23-C: the region rides the SSR page's own ?gl= query (measured — the
 * returned payload carries the requested gl) and the public-mode search
 * fallback's context.client.gl (measured — the ranked set reshapes per
 * region). Public mode: /feed/trending redirects to the What-to-Watch nudge
 * (probed live) → the rail fills with real search-backed popular-this-week
 * videos; `source` in the response says which path produced it.
 */
export async function GET(req: Request) {
  try {
    if (!(await rateLimit(`trending:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const url = new URL(req.url);
    const category = normalizeTrendingCategory(url.searchParams.get("category"));
    const region = normalizeTrendingRegion(url.searchParams.get("region"));
    const page = await getTrendingPage(category, region);
    const data: TrendingPageDTO = {
      category: page.category,
      videos: page.videos,
      source: page.source,
      region: page.region,
    };
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/trending failed", err);
    return NextResponse.json({ error: "Failed to load trending" }, { status: 502 });
  }
}
