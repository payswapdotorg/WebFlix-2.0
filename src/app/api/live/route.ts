import { NextResponse } from "next/server";
import { getLiveSurface } from "@/lib/youtube/live-surface";
import { rateLimit } from "@/lib/youtube/cache";
import type { LivePageDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/live — the Live surface (WFX2-B-W + P21-LIVE-PREMIERES). Real
 * currently-live videos: the Features→Live search filter (EgJAAQ==, the
 * option from YouTube's own filter menu) applied to a live-scoped query
 * set, merged + de-duplicated. Every item carries isLive + the real
 * watching count ("1,001 watching" in viewsText). Verified live (20/20
 * live results on q="live").
 *
 * P21: premieringSoon — the UPCOMING items the same seed queries surface
 * (upcomingEventData.startTime → premieredAt, future only), soonest-first.
 * Honestly [] when the searches can't reach any (public mode) — never faked.
 */
export async function GET(req: Request) {
  try {
    if (!(await rateLimit(`live:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const limitParam = new URL(req.url).searchParams.get("limit");
    const limit = Math.min(Math.max(Number(limitParam) || 24, 1), 48);
    const { watchingNow, premieringSoon } = await getLiveSurface(limit, 12);
    const data: LivePageDTO = { videos: watchingNow, premieringSoon };
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/live failed", err);
    return NextResponse.json({ error: "Failed to load live videos" }, { status: 502 });
  }
}
