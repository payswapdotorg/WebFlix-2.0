import { NextResponse } from "next/server";
import { getPlayback } from "@/lib/youtube/streams";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * Task 2-c — GET /api/videos/[id]/playback
 *
 * The embed-wall fallback chain's data source: server-side player response
 * (innertube `player` → the watch page's ytInitialPlayerResponse; see
 * src/lib/youtube/streams.ts). Returns `PlaybackDto` — `streamFormats` for
 * the native <video> swap (played through /api/stream) and `storyboards`
 * for the hover preview. Walled egress → empty arrays (HTTP 200, the
 * honest degrade the client renders as the blocked card / zoom-pan).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await rateLimit(`playback:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  try {
    const { id } = await ctx.params;
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
      return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
    }
    return NextResponse.json(await getPlayback(id));
  } catch (err) {
    console.error("GET /api/videos/[id]/playback failed", err);
    return NextResponse.json(
      { streamFormats: [], storyboards: [], durationSec: null, source: "" },
      { status: 200 }
    );
  }
}
