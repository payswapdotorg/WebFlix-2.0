import { NextResponse } from "next/server";
import { getHomeFeed } from "@/lib/youtube/feeds";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/home?category= — the default home climbs the WFX2-HR ladder:
 * browse-fresh → Upstash last-good (24h window) → search-backed compose, so
 * the default "All" feed never serves empty rails while real search data is
 * available (browse is walled for the server egress; search is not). The DTO
 * carries `source: "browse" | "last-good" | "search-compose"` so the harness
 * + UI can distinguish. Category mode is the established search-backed flat
 * grid; continue-watching rides the history SSR when a session exists.
 */
export async function GET(req: Request) {
  try {
    if (!(await rateLimit(`home:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const category = new URL(req.url).searchParams.get("category");
    const feed = await getHomeFeed(category);
    return NextResponse.json(feed);
  } catch (err) {
    console.error("GET /api/home failed", err);
    return NextResponse.json({ error: "Failed to load home feed" }, { status: 502 });
  }
}
