import { NextResponse } from "next/server";
import { getPlaylistItems } from "@/lib/youtube/playlists";
import { hasSession } from "@/lib/youtube/session";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/liked?cursor= — the operator's Liked Videos (YouTube's own `LL`
 * playlist, read via browse `VLLL` — auth-gated). Public mode answers the
 * upstream's own "The playlist does not exist." alert honestly →
 * { videos: [], loginRequired: true }. No fake rows.
 */
export async function GET(req: Request) {
  try {
    if (!(await rateLimit(`liked:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;
    const page = await getPlaylistItems("LL", { cursor: cursor || undefined });
    if (page.notFound) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }
    return NextResponse.json({
      videos: page.videos,
      playlist: page.playlist,
      nextCursor: page.nextCursor,
      loginRequired: page.loginRequired,
      session: hasSession(),
    });
  } catch (err) {
    console.error("GET /api/liked failed", err);
    return NextResponse.json({ error: "Failed to load liked videos" }, { status: 502 });
  }
}
