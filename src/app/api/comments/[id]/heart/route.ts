import { NextRequest } from "next/server";
import { json, errorResponse, ApiError } from "@/lib/watch/api";
import { proxyCommentHeart } from "@/lib/watch/action-proxy";
import { getWatchMetadata } from "@/lib/youtube/watch";
import { operatorIsCreator } from "@/lib/youtube/operator";

export const dynamic = "force-dynamic";

/**
 * POST /api/comments/[id]/heart — LIVE Tier-2 write: creator heart toggle
 * (broker comment-heart — the ⋮ → Heart / Remove heart DOM path).
 *
 * Creator-mode guard: only the operator session that IS the video's channel
 * may heart (the watch page's isCreator flag gates the menu the same way);
 * otherwise 403, honestly. Request: {videoId, commentText?} (commentText =
 * the comment's CURRENT text — the broker's DOM locator).
 *
 * Response: {ok, effect, heartedByCreator, path?}.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

    // creator-mode: the operator session must be the video's channel
    const meta = await getWatchMetadata(videoId);
    if (!meta) return json({ error: "Video not found" }, 404);
    const isCreator = await operatorIsCreator(meta.video.channel.id);
    if (!isCreator) {
      throw new ApiError(403, "Only the video's channel owner can heart comments");
    }

    const result = await proxyCommentHeart(id, {
      videoId,
      ...(commentText ? { commentText } : {}),
    });
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
