import { NextRequest, NextResponse } from "next/server";
import { getTikTokFeedPage } from "@/lib/tiktok/library";
import { isTikTokPostId } from "@/lib/tiktok/urls";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/tiktok/feed — the /shorts TikTok feed pages (ADR 0013 §6,
 * WFX2-TIKTOK-SHORTS-EXPERIENCE-1): cursor pagination over the curated
 * library in the SAME `{ items, nextCursor }` shape law as /api/shorts.
 *
 * Query:
 *  - `cursor` — the previous page's last post id (opaque to the client);
 *    absent → page 1.
 *  - `post` — a deep-linked post id, spliced FIRST on page 1 only (the
 *    /shorts?source=tiktok&post= contract; any canonical post works).
 *  - `limit` — 1..40 (the curated cap bounds it).
 *
 * Every row is honestly resolved through the cached oEmbed lane (walled
 * egress → honest cards, the embed rides viewer-side). Rate-limited like
 * the sibling TikTok routes.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await rateLimit(`tiktok:feed:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const params = req.nextUrl.searchParams;
    const cursor = params.get("cursor");
    const post = params.get("post");
    const limitRaw = Number(params.get("limit") ?? "");
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : undefined;

    if (cursor && !isTikTokPostId(cursor)) {
      return NextResponse.json({ error: "Invalid TikTok post id" }, { status: 400 });
    }
    if (post && !isTikTokPostId(post)) {
      return NextResponse.json({ error: "Invalid TikTok post id" }, { status: 400 });
    }
    const page = await getTikTokFeedPage({
      cursor: cursor || null,
      post: post || null,
      // a positive integer passes through; the library clamps to the cap
      limit,
    });
    return NextResponse.json(page, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("GET /api/tiktok/feed failed", err);
    return NextResponse.json({ error: "Failed to load the TikTok feed" }, { status: 502 });
  }
}
