import { NextResponse } from "next/server";
import { getHomeFeed } from "@/lib/youtube/feeds";
import { rateLimit } from "@/lib/youtube/cache";
import { getSessionUser } from "@/lib/auth/session";
import { makeShuffleSeed } from "@/lib/playlist/shuffle";
import { resolveHomeVariety } from "@/lib/watch/home-variety";

export const dynamic = "force-dynamic";

/**
 * GET /api/home?category= — the default home climbs the WFX2-HR ladder:
 * browse-fresh → Upstash last-good (24h window) → search-backed compose, so
 * the default "All" feed never serves empty rails while real search data is
 * available (browse is walled for the server egress; search is not). The DTO
 * carries `source: "browse" | "last-good" | "search-compose"` so the harness
 * + UI can distinguish. Category mode is the established search-backed flat
 * grid; continue-watching rides the history SSR when a session exists.
 *
 * P81-b — the variety layer (the "always the same videos" fix):
 *  - `seed`: a FRESH server-side seed per request — youtube.com's own
 *    signed-out home reshuffles its inventory per navigation (measured);
 *    the rotation is post-cache derivation over the already-fetched pool,
 *    so the shared upstream cache keys stay unseeded (no fragmentation).
 *  - `exclude`: the signed-in viewer's WebFlix-local feedback rows
 *    (VideoSignal: not-interested + dont-recommend-channel), resolved
 *    THROUGH the home-variety proxy (the purge-sweep law keeps this read
 *    route db-import-free; /api/videos/[id] reads the viewer's Watch-Later
 *    through the same pattern). Signed-out → rotation only (honest zero).
 */
export async function GET(req: Request) {
  try {
    if (!(await rateLimit(`home:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const category = new URL(req.url).searchParams.get("category");

    // P81-b — the variety inputs (best-effort by law: a personalization
    // miss degrades to rotation-only, never a feed failure).
    const sessionUser = await getSessionUser(req);
    const variety = await resolveHomeVariety(makeShuffleSeed(), sessionUser);

    const feed = await getHomeFeed(category, variety);
    return NextResponse.json(feed);
  } catch (err) {
    console.error("GET /api/home failed", err);
    return NextResponse.json({ error: "Failed to load home feed" }, { status: 502 });
  }
}
