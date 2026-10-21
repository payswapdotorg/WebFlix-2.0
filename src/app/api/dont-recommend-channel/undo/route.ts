import { errorResponse, json } from "@/lib/watch/api";
import { proxyFeedbackUndo } from "@/lib/watch/action-proxy";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * P24-SEND (G12) → WFX2-P36 — POST /api/dont-recommend-channel/undo:
 * removes the WebFlix-LOCAL dont-recommend-channel signal (always
 * available — the signal is ours; no YouTube toast window is needed or
 * claimed). Response: {ok, effect:"feedback-undo", restored:true, local, note}.
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
    const result = await proxyFeedbackUndo(videoId, "dont_recommend_channel", sessionUser);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
