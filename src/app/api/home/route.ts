import { NextResponse } from "next/server";
import { getHomeFeed } from "@/lib/youtube/feeds";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/home?category= — live home feed from browse FEwhat_to_watch:
 * real shelves → hero / shorts shelf / because-you-watched (a real shelf
 * title) / recommended rail + continuation cursor; continue-watching rides
 * the history SSR when a session exists (omitted gracefully otherwise).
 */
export async function GET(req: Request) {
  try {
    if (!rateLimit(`home:${req.headers.get("x-forwarded-for") ?? "local"}`)) {
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
