import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { listPlaylists, createPlaylist } from "@/lib/watch/playlist-service";
import { playlistCreateBodySchema } from "@/lib/watch/validators";

export const dynamic = "force-dynamic";

/**
 * GET /api/playlists?videoId= — the viewer's playlists (Watch later first)
 * with containsVideo flags for the Save dialog.
 */
export async function GET(req: NextRequest) {
  try {
    const viewer = await resolveViewer(req.headers);
    const videoId = new URL(req.url).searchParams.get("videoId");
    if (!videoId) return json({ error: "videoId is required" }, { status: 400 });
    const playlists = await listPlaylists(videoId, viewer.id);
    return json({ playlists });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST /api/playlists {name, visibility} — create-new from the Save dialog. */
export async function POST(req: NextRequest) {
  try {
    const viewer = await resolveViewer(req.headers);
    const body = playlistCreateBodySchema.parse(await req.json());
    const playlist = await createPlaylist(viewer.id, body.name, body.visibility);
    return json({ playlist }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
