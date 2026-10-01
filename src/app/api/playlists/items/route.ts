import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyPlaylistAdd } from "@/lib/watch/action-proxy";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/playlists/items {playlistId, videoId, title?} — LIVE Tier-2
 * write (broker playlist-add: the Save dialog row / edit_playlist).
 *
 * Adds the video to the playlist (ensure-added — already there →
 * {added:false, reason:"already-saved"} like the previous contract).
 * `title` (the playlist's label) lets the broker use the Save-dialog UI
 * path; real YouTube playlist ids (PL…/VL…) also work via the fetch
 * fallback. Response: {ok, effect, added, reason?}.
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
    const result = await proxyPlaylistAdd(playlistId, videoId, { mode: "add", title });
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
