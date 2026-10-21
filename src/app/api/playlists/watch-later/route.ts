import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyWatchLater } from "@/lib/watch/action-proxy";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/playlists/watch-later {videoId, add?} — WFX2-P36: the honest
 * WebFlix-LOCAL watch-later list (local:true, the note says why: YouTube's
 * WL is a system playlist the official Data API cannot write — the
 * pre-P36 operator-session WL write is retired with the rest of the shared
 * identity paths).
 *
 * `add` omitted → toggle (the video-card contract); true/false → ensure.
 * Response: {ok, effect, added, playlistId, local, note}.
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
    const add =
      body.add === true ? true : body.add === false ? false : undefined;
    const result = await proxyWatchLater(videoId, add, sessionUser);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
