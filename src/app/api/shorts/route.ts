import { NextRequest, NextResponse } from "next/server";
import {
  cacheGet,
  cacheSet,
  rateLimit,
} from "@/lib/youtube/livechat";
import {
  getShortsPage,
  getShortsSeed,
  type ShortsFeedDTO,
} from "@/lib/youtube/shorts";

/**
 * WFX2-A-S — Shorts feed (real youtube.com data end-to-end).
 *
 * GET /api/shorts           → seed page (search-backed shorts shelves +
 *                             reel_watch_sequence cursor)
 * GET /api/shorts?cursor=…  → next page (reel/reel_watch_sequence with the
 *                             token as top-level sequenceParams — verified)
 *
 * Seed items carry title/views from the real search response; cursor-page
 * entries are bare (the reel sequence returns ids only) — the client
 * hydrates each via GET /api/shorts/[id]. Seed cached 5 minutes.
 */

export const dynamic = "force-dynamic";

const SEED_TTL_MS = 5 * 60 * 1000;

export async function GET(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local";
  if (!rateLimit(`shorts:${ip}`)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const cursor = req.nextUrl.searchParams.get("cursor");

  try {
    if (cursor) {
      const feed = await getShortsPage(cursor);
      return NextResponse.json(feed, {
        headers: { "Cache-Control": "private, max-age=60" },
      });
    }
    const cached = cacheGet<ShortsFeedDTO>("shorts:seed");
    if (cached) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "private, max-age=60" },
      });
    }
    const feed = await getShortsSeed();
    cacheSet("shorts:seed", feed, SEED_TTL_MS);
    return NextResponse.json(feed, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Shorts upstream failed",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 502 },
    );
  }
}
