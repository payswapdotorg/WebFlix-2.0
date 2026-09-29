import { NextResponse } from "next/server";
import { listLiveVideos } from "@/lib/youtube/feeds";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/videos?cursor=&category=&limit= — live feed pagination.
 * Cursors are InnerTube continuation tokens (opaque strings); category pages
 * are search-backed (type=video), the default page continues the browse feed.
 */
export async function GET(req: Request) {
  try {
    if (!rateLimit(`videos:${req.headers.get("x-forwarded-for") ?? "local"}`)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const params = new URL(req.url).searchParams;
    const result = await listLiveVideos({
      cursor: params.get("cursor"),
      category: params.get("category"),
      limit: params.get("limit") ? Number(params.get("limit")) : undefined,
    });
    return NextResponse.json({ videos: result.videos, nextCursor: result.nextCursor });
  } catch (err) {
    console.error("GET /api/videos failed", err);
    return NextResponse.json({ error: "Failed to list videos" }, { status: 502 });
  }
}
