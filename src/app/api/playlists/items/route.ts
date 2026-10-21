import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyPlaylistAdd, resolveActionTier } from "@/lib/watch/action-proxy";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/playlists/items {playlistId, videoId, title?} — WFX2-P36: the
 * per-user official playlistItems lane (the user's OWN playlists), with the
 * membership read-back (`verified` in the full result; this route keeps the
 * Save-dialog's compact shape). WL/LL ids → the honest 501 (the local
 * watch-later lane serves the WL surface).
 *
 * Adds the video to the playlist (ensure-added — already there →
 * {added:false, reason:"already-saved"} like the previous contract).
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
    const playlistId = typeof body.playlistId === "string" ? body.playlistId : "";
    const videoId = typeof body.videoId === "string" ? body.videoId : "";
    if (!playlistId || !videoId) {
      return json({ error: "playlistId and videoId are required" }, 400);
    }
    const title = typeof body.title === "string" ? body.title : undefined;
    const tier = await resolveActionTier(req);
    const result = await proxyPlaylistAdd(playlistId, videoId, { mode: "add", title }, tier);
    return json({
      ok: result.ok,
      effect: result.effect,
      added: result.added,
      ...(result.already ? { reason: "already-saved" } : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
