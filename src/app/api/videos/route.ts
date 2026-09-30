import { NextResponse } from "next/server";
import { listLiveVideos } from "@/lib/youtube/feeds";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/videos?cursor=&category=&limit=&q= — live feed pagination.
 * Cursors are InnerTube continuation tokens (opaque strings); category pages
 * are search-backed (type=video), the default page continues the browse feed.
 * WFX2-C-W: `q=` routes to the search-backed listing — search is NOT walled
 * for Vercel egress (browse is), which fixes the production
 * `/api/videos?q=music → {"videos":[]}` finding. First pages are cached
 * through the Upstash adapter (10-minute TTL, last-good on failure).
 */
export async function GET(req: Request) {
  try {
    if (!(await rateLimit(`videos:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const params = new URL(req.url).searchParams;
    const result = await listLiveVideos({
      cursor: params.get("cursor"),
      category: params.get("category"),
      limit: params.get("limit") ? Number(params.get("limit")) : undefined,
      query: params.get("q"),
    });
    return NextResponse.json({ videos: result.videos, nextCursor: result.nextCursor });
  } catch (err) {
    console.error("GET /api/videos failed", err);
    return NextResponse.json({ error: "Failed to list videos" }, { status: 502 });
  }
}
