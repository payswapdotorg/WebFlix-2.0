import { NextRequest, NextResponse } from "next/server";
import { isSpecialPlaylistId } from "@/lib/youtube/playlists";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import { proxyPlaylistReorder } from "@/lib/watch/action-proxy";
import { ApiError } from "@/lib/watch/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/playlists/[id]/reorder { fromIndex, toIndex, videoId? } — move a
 * video in the operator's real YouTube playlist (broker kind
 * `playlist-reorder`, Tier-2 — the playlist page's real drag handle: a
 * stepped pointer-event ladder). The special lists WL/LL cannot be reordered
 * (YouTube's own lists) — honest 400.
 *
 * Response: {ok, effect, verified, fromIndex, toIndex, videoId?, path?};
 * verified:false when the drop fired but the list did not re-render the new
 * order within the deadline (honest unverified).
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
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("POST /api/playlists/[id]/reorder failed", err);
    return NextResponse.json({ error: "Failed to reorder playlist" }, { status: 500 });
  }
}
