import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { togglePlaylistItem } from "@/lib/watch/playlist-service";
import { playlistItemBodySchema } from "@/lib/watch/validators";

export const dynamic = "force-dynamic";

/**
 * POST /api/playlists/[id]/items {videoId} — add/remove the video to one of
 * the viewer's playlists (toggle).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewer = await resolveViewer(req.headers);
    const body = playlistItemBodySchema.parse(await req.json());
    const result = await togglePlaylistItem(id, body.videoId, viewer.id);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
