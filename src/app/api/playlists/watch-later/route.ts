import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyWatchLater } from "@/lib/watch/action-proxy";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/playlists/watch-later {videoId, add?} — LIVE Tier-2 write
 * (broker watch-later: YouTube's own WL playlist).
 *
 * `add` omitted → toggle (the video-card contract); true/false → ensure.
 * Response: {ok, effect, added, playlistId} — the previous contract plus
 * ok/effect.
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
    const add =
      body.add === true ? true : body.add === false ? false : undefined;
    const result = await proxyWatchLater(videoId, add);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
