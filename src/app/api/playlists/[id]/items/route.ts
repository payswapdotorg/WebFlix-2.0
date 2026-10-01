import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyPlaylistAdd } from "@/lib/watch/action-proxy";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/playlists/[id]/items {videoId} — LIVE Tier-2 write (broker
 * playlist-add, toggle mode — the save dialog's row contract).
 *
 * Response: {ok, effect, containsVideo} — the contract SaveDialog consumes
 * (its optimistic UI flips `containsVideo`), plus ok/effect.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    const { id } = await ctx.params;
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const videoId = typeof body.videoId === "string" ? body.videoId : "";
    if (!videoId) return json({ error: "videoId is required" }, 400);
    const title = typeof body.title === "string" ? body.title : undefined;
    const result = await proxyPlaylistAdd(id, videoId, { mode: "toggle", title });
    return json({ ok: result.ok, effect: result.effect, containsVideo: result.containsVideo });
  } catch (e) {
    return errorResponse(e);
  }
}
