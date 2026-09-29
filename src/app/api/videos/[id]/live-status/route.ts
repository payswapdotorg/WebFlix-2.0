import { NextRequest, NextResponse } from "next/server";
import {
  callUpdatedMetadata,
  InnerTubeChatError,
  parseUpdatedMetadata,
  rateLimit,
} from "@/lib/youtube/livechat";

/**
 * WFX2-A-S — live status endpoint.
 *
 * GET /api/videos/[id]/live-status
 *   → POST /youtubei/v1/updated_metadata {videoId}
 *   → { isLive, concurrentViewers, viewersText, likesText, dateText, pollMs }
 *
 * The client polls this on the watch page while a stream is live (pollMs
 * from the response's own timedContinuationData.timeoutMs, default 5000).
 * dateText only appears when YouTube pushes an updateDateTextAction.
 */

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: videoId } = await ctx.params;
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local";
  if (!rateLimit(`live-status:${ip}`, 60, 1)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  try {
    const res = await callUpdatedMetadata(videoId);
    const status = parseUpdatedMetadata(res);
    return NextResponse.json(status, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    // Non-live / removed videos: updated_metadata errors out — report the
    // stream as not live rather than failing the watch page.
    if (err instanceof InnerTubeChatError) {
      return NextResponse.json(
        {
          isLive: false,
          concurrentViewers: null,
          viewersText: null,
          likesText: null,
          dateText: null,
          pollMs: 5000,
          detail: err.message,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "Live status upstream failed" },
      { status: 502 },
    );
  }
}
