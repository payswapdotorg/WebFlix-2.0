import { NextResponse } from "next/server";
import { searchTikTokLibrary } from "@/lib/tiktok/library";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/tiktok/search?q= — the curated-library search (P58, ADR 0004 §3):
 * additive to the YouTube search lane, rides the curated universe ONLY, and
 * answers with real metadata or an honest empty set (render-when-answers —
 * the shelf never renders a placeholder row).
 */
export async function GET(req: Request) {
  try {
    if (!(await rateLimit(`tiktok:search:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 120);
    const results = await searchTikTokLibrary(q);
    return NextResponse.json(results, {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=86400" },
    });
  } catch (err) {
    console.error("GET /api/tiktok/search failed", err);
    return NextResponse.json({ error: "Failed to search the TikTok library" }, { status: 502 });
  }
}
