import { NextResponse } from "next/server";
import { getTikTokVideo } from "@/lib/tiktok/library";
import { isTikTokPostId } from "@/lib/tiktok/urls";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/tiktok/video/[id] — one curated post's payload (P58, ADR 0004):
 * the cached oEmbed enrichment + the locally-built Embed Player URL. 400 on a
 * non-post-id; an unreachable oEmbed answers 200 with the honest unavailable
 * DTO (the embed lane is viewer-side and unaffected — the status tells the
 * truth about WebFlix's answer, the DTO tells the truth about TikTok's).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!(await rateLimit(`tiktok:video:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const { id } = await ctx.params;
    if (!isTikTokPostId(id)) {
      return NextResponse.json({ error: "Invalid TikTok post id" }, { status: 400 });
    }
    const video = await getTikTokVideo(id);
    return NextResponse.json(video, {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=86400" },
    });
  } catch (err) {
    console.error("GET /api/tiktok/video/[id] failed", err);
    return NextResponse.json({ error: "Failed to load the TikTok video" }, { status: 502 });
  }
}
