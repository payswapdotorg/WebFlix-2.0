import { NextResponse } from "next/server";
import { getPublicPlaylist } from "@/lib/youtube/playlist";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/playlist/[id]?cursor= — the public playlist page data
 * (WFX2-B-W): browse {browseId: "VL<playlistId>"} → header (title, owner,
 * stats) + the video grid (lockupViewModels). Playlist-result cards from
 * search link here.
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
