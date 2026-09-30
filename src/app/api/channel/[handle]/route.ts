import { NextResponse } from "next/server";
import { getChannelPageResilient } from "@/lib/youtube/channels";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/channel/[handle] — the live channel page under the cutover
 * resilience contract (WFX2-B-S):
 *
 *  - healthy read → the normal ChannelPageDTO (tabs + joinable included);
 *  - the wall hits (the @handle SSR scrape 404s / the channel-renderer
 *    search path is empty on server egress) and a last-good page exists →
 *    the last-good page serves (never cached as the walled shape);
 *  - cold + walled → HTTP 200 with the structured honest degrade
 *    `{channel: null, videos: [], shorts: [], tabs: [], walled: true,
 *    note}` — NEVER a naked 502.
 *
 * `handle` accepts "@name" or "UC…".
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ handle: string }> }
) {
  try {
    if (!(await rateLimit(`channel:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const { handle } = await params;
    const { page, walled } = await getChannelPageResilient(handle);
    if (!page) {
      // honest degrade: structured empty + walled context, HTTP 200
      return NextResponse.json({
        channel: null,
        videos: [],
        shorts: [],
        tabs: [],
        joinable: false,
        walled: true,
        note:
          "Channel data is unavailable from this egress right now (youtube.com walls the channel read path for server IPs). A last-known copy serves here once one exists — no data is fabricated.",
      });
    }
    return NextResponse.json({ ...page, walled });
  } catch (err) {
    // belt-and-braces: this path should be unreachable (the resilient wrapper
    // absorbs upstream failures) — still never a naked 502
    console.error("GET /api/channel/[handle] failed", err);
    return NextResponse.json({
      channel: null,
      videos: [],
      shorts: [],
      tabs: [],
      joinable: false,
      walled: true,
      note: "Channel data is unavailable from this egress right now.",
    });
  }
}
