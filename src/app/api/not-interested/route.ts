import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyNotInterested } from "@/lib/watch/action-proxy";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/not-interested {videoId} — WFX2-P36: the WebFlix-LOCAL
 * personalization signal (fully disclosed: "Hidden on WebFlix" — YouTube's
 * own Not-interested has no official API, so no YouTube-side write is
 * claimed). Response keeps the {hidden: true} contract the video-card
 * kebab consumes (+ok/effect/local/note).
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
    const result = await proxyNotInterested(videoId, sessionUser);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
