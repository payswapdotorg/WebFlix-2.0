import { NextRequest, NextResponse } from "next/server";
import { isSpecialPlaylistId } from "@/lib/youtube/playlists";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import { proxyPlaylistReorder } from "@/lib/watch/action-proxy";
import { errorResponse } from "@/lib/watch/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/playlists/[id]/reorder { fromIndex, toIndex, videoId? } — WFX2-P36:
 * the HONEST UNSUPPORTED lane. Playlist reordering has no safe official
 * YouTube Data API path (playlistItems.update position swaps are unreliable
 * and policy-uncertain), and the pre-P36 broker drive (reordering the
 * operator's tab) is retired with every other shared-identity write — so the
 * proxy throws the honest 501 (kind "youtube-unsupported", the handoff to
 * YouTube) and this route renders it verbatim. The special lists WL/LL keep
 * their own honest 400 (YouTube's own lists, not reorderable at all).
 *
 * Response: 501 { error, kind: "youtube-unsupported" } — reorder on
 * youtube.com's own playlist page.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    const { id } = await ctx.params;
    if (!id || !/^[\w-]{2,64}$/.test(id)) {
      return NextResponse.json({ error: "invalid playlist id" }, { status: 400 });
    }
    if (isSpecialPlaylistId(id)) {
      return NextResponse.json(
        {
          error:
            "Watch later and Liked videos are YouTube's own lists and cannot be reordered",
        },
        { status: 400 }
      );
    }
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
    }
    const fromIndex =
      typeof body.fromIndex === "number" && Number.isInteger(body.fromIndex) && body.fromIndex >= 0
        ? body.fromIndex
        : null;
    const toIndex =
      typeof body.toIndex === "number" && Number.isInteger(body.toIndex) && body.toIndex >= 0
        ? body.toIndex
        : null;
    if (fromIndex === null || toIndex === null) {
      return NextResponse.json(
        { error: "fromIndex and toIndex are required (non-negative integers)" },
        { status: 400 }
      );
    }
    if (fromIndex === toIndex) {
      return NextResponse.json(
        { error: "fromIndex and toIndex must differ" },
        { status: 400 }
      );
    }
    const videoId = typeof body.videoId === "string" && body.videoId.length > 0 ? body.videoId : undefined;
    const result = await proxyPlaylistReorder(id, fromIndex, toIndex, videoId);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
