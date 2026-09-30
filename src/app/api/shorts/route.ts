import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/youtube/livechat";
import { cachedResilient, TTL } from "@/lib/youtube/cache";
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
 * hydrates each via GET /api/shorts/[id].
 *
 * WFX2-C-W: the seed is cached through the Upstash adapter (5-minute soft
 * TTL, stale-while-revalidate, last-good on upstream failure — an empty
 * seed is never cached over a good one). Cursor pages pass straight through
 * (unique tokens).
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local";
  if (!(await rateLimit(`shorts:${ip}`))) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const cursor = req.nextUrl.searchParams.get("cursor");

  try {
    const headers = { "Cache-Control": "private, max-age=60" } as const;
    if (cursor) {
      const feed = await getShortsPage(cursor);
      return NextResponse.json(feed, { headers });
    }
    const feed = await cachedResilient(
      "shorts:seed",
      TTL.SHORTS_SEED_MS,
      () => getShortsSeed(),
      { isEmpty: (f) => (f as ShortsFeedDTO).items.length === 0 },
    );
    return NextResponse.json(feed, { headers });
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
