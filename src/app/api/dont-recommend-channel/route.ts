import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyDontRecommendChannel } from "@/lib/watch/action-proxy";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * P24-SEND (G12) → WFX2-P36 — POST /api/dont-recommend-channel {videoId}:
 * the WebFlix-LOCAL personalization signal (fully disclosed — YouTube's own
 * Don't-recommend-channel has no official API, so no YouTube-side write is
 * claimed). The undo removes the local signal. Response keeps the
 * {hidden: true} contract the video-card kebab consumes (+ok/effect/local/note).
 */
export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return authRequiredResponse();
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const videoId = typeof body.videoId === "string" ? body.videoId : "";
    if (!videoId) return json({ error: "videoId is required" }, 400);
    const result = await proxyDontRecommendChannel(videoId, sessionUser);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
