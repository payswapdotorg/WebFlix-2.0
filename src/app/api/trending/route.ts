import { NextResponse } from "next/server";
import { getTrending } from "@/lib/youtube/feeds";
import { rateLimit } from "@/lib/youtube/cache";
import { normalizeCategory } from "@/lib/categories";
import type { TrendingPageDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/trending?category= — SSR parse of /feed/trending (+ the real
 * category pages: /feed/trending/music|gaming|movies…). The browse XHR for
 * trending is rejected server-side (research log §5) — SSR is the mechanism.
 */
export async function GET(req: Request) {
  try {
    if (!rateLimit(`trending:${req.headers.get("x-forwarded-for") ?? "local"}`)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const category = normalizeCategory(new URL(req.url).searchParams.get("category"));
    const videos = await getTrending(category);
    const data: TrendingPageDTO = { category, videos };
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/trending failed", err);
    return NextResponse.json({ error: "Failed to load trending" }, { status: 502 });
  }
}
