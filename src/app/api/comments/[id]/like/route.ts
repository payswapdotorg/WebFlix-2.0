import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyCommentLike } from "@/lib/watch/action-proxy";
import type { LikeValue } from "@/lib/watch/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/comments/[id]/like — LIVE Tier-2 write (broker comment-like).
 *
 * Request (UI shapes kept):
 *   { value: "like" | "dislike" }               legacy — toggle semantics
 *   { action: "like" | "dislike" | "none" }     canonical — set semantics
 *   { baseline?: { likes, yourLike }, commentText?, videoId? }
 *     commentText lets the broker locate the comment in the watch-page DOM
 *     (the verified UI path); videoId scopes the search.
 *
 * Response: { ok, effect, likes, yourLike } — the CommentLikeResultDto
 * contract the comment rows consume.
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
    const value = typeof body.value === "string" ? (body.value as LikeValue) : undefined;
    const action =
      typeof body.action === "string" ? (body.action as "like" | "dislike" | "none") : undefined;
    if (!value && !action) {
      return json({ error: "value (like|dislike) or action (like|dislike|none) is required" }, 400);
    }
    const baselineRaw = body.baseline as { likes?: number; yourLike?: LikeValue | null } | undefined;
    const baseline =
      baselineRaw && typeof baselineRaw === "object"
        ? {
            likes: Number.isFinite(baselineRaw.likes) ? Number(baselineRaw.likes) : undefined,
            yourLike:
              baselineRaw.yourLike === "like" || baselineRaw.yourLike === "dislike"
                ? baselineRaw.yourLike
                : null,
          }
        : undefined;
    const commentText = typeof body.commentText === "string" ? body.commentText : undefined;
    const videoId = typeof body.videoId === "string" ? body.videoId : undefined;
    const result = await proxyCommentLike(id, { value, action, baseline, commentText, videoId });
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
