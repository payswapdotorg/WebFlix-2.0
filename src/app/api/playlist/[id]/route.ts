import { NextResponse } from "next/server";
import { getPublicPlaylist } from "@/lib/youtube/playlist";
import { isSpecialPlaylistId } from "@/lib/youtube/playlists";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/playlist/[id]?cursor= — the public playlist page data
 * (WFX2-B-W): browse {browseId: "VL<playlistId>"} → header (title, owner,
 * stats) + the video grid (lockupViewModels). Playlist-result cards from
 * search link here.
 *
 * WFX2-P36: the PUBLIC PL… reads stay exactly as they are (public content,
 * no identity involved). The special lists WL/LL answer the honest per-user
 * notice envelope instead — the pre-P36 branch read the OPERATOR's Watch
 * Later / Liked list through the session seam and served it to every
 * signed-in user (the exact cross-user leak the P36 work order closes), and
 * neither list has an official per-user read API. The notice hands Watch
 * later off to the WebFlix-local save button and the rest to YouTube's own
 * pages (the same envelope as the sibling /api/playlists/[id] route).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await rateLimit(`playlist:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const { id } = await params;
    if (isSpecialPlaylistId(id)) {
      // WFX2-P36 — the honest per-user notice (never the operator's list)
      return NextResponse.json({
        playlist: null,
        videos: [],
        nextCursor: null,
        loginRequired: false,
        unavailable: false,
        special: true,
        notice:
          "YouTube's Watch Later / Liked lists have no official API — your WebFlix Watch later lives in the save button (local), and YouTube's own page has the rest",
      });
    }
    const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;
    const page = await getPublicPlaylist(id, cursor);
    if (!page) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }
    return NextResponse.json(page);
  } catch (err) {
    console.error("GET /api/playlist/[id] failed", err);
    return NextResponse.json({ error: "Failed to load playlist" }, { status: 502 });
  }
}
