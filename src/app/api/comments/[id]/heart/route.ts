import { NextRequest } from "next/server";
import { json, errorResponse, ApiError } from "@/lib/watch/api";
import { proxyCommentHeart } from "@/lib/watch/action-proxy";
import { getWatchMetadata } from "@/lib/youtube/watch";
import { operatorIsCreator } from "@/lib/youtube/operator";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/comments/[id]/heart — WFX2-P36: the HONEST UNSUPPORTED lane.
 * Creator hearts have no official end-user API (they live in YouTube's own
 * creator surfaces), and the pre-P36 broker DOM drive is retired with the
 * shared operator identity — the proxy answers the honest 501 (kind
 * "youtube-unsupported"), rendered verbatim by errorResponse.
 *
 * Request: {videoId, commentText?} (kept for the request contract; the
 * creator-mode guard below stays the honest 403 for non-creators).
 *
 * Response: 501 { error, kind: "youtube-unsupported" } — heart on YouTube.
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
