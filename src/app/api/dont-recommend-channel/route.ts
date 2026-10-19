import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyDontRecommendChannel } from "@/lib/watch/action-proxy";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * P24-SEND (G12) — POST /api/dont-recommend-channel {videoId} — LIVE Tier-2
 * write (broker): the feed card's own ⋯ "Don't recommend channel" action,
 * executed as the real home-feed action on youtube.com (the not-interested
 * drive's sibling). The undo window opens with youtube.com's own toast —
 * POST /api/dont-recommend-channel/undo clicks its Undo button while the
 * window is live. Response keeps the {hidden: true} contract the video-card
 * kebab consumes (+ok/effect/path).
 */
export async function POST(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const videoId = typeof body.videoId === "string" ? body.videoId : "";
    if (!videoId) return json({ error: "videoId is required" }, 400);
    const result = await proxyDontRecommendChannel(videoId);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
