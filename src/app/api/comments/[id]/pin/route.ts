import { NextRequest } from "next/server";
import { json, errorResponse, ApiError } from "@/lib/watch/api";
import { proxyCommentPin } from "@/lib/watch/action-proxy";
import { getWatchMetadata } from "@/lib/youtube/watch";
import { operatorIsCreator } from "@/lib/youtube/operator";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/comments/[id]/pin — LIVE Tier-2 write: creator pin/unpin toggle
 * (broker comment-pin — the ⋮ → Pin / Unpin DOM path; top-level comments
 * only, exactly YouTube's constraint).
 *
 * Creator-mode guard: only the operator session that IS the video's channel
 * may pin; otherwise 403, honestly. Request: {videoId, commentText?}
 * (commentText = the comment's CURRENT text — the broker's DOM locator).
 *
 * Response: {ok, effect, pinned, path?}.
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
    const commentText =
      typeof body.commentText === "string" && body.commentText ? body.commentText : undefined;

    const meta = await getWatchMetadata(videoId);
    if (!meta) return json({ error: "Video not found" }, 404);
    const isCreator = await operatorIsCreator(meta.video.channel.id);
    if (!isCreator) {
      throw new ApiError(403, "Only the video's channel owner can pin comments");
    }

    const result = await proxyCommentPin(id, {
      videoId,
      ...(commentText ? { commentText } : {}),
    });
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
