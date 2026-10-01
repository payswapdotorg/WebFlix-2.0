import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyPostCommentLike } from "@/lib/community/action-proxy";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * POST /api/posts/[postId]/comments/[commentId]/like — LIVE Tier-2 write
 * (broker post-comment-like: the comment located by text in the post page's
 * comments DOM, its real like button clicked, aria-pressed verified).
 *
 * Request (the comment-like shapes, kept):
 *   { action: "like" | "dislike" | "none" }   canonical — set semantics
 *   { value: "like" }                         legacy — toggle semantics
 *   { baseline?: { likes, yourLike }, commentText? }
 *     commentText lets the broker locate the comment in the post page DOM
 *     (the verified UI path).
 *
 * Response: { ok, effect, likes, yourLike } — the PostCommentLikeResult
 * contract the post comment rows consume.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ postId: string; commentId: string }> }
) {
  try {
    if (!(await rateLimit(`post-comment-like:${req.headers.get("x-forwarded-for") ?? "local"}`, { limit: 60 }))) {
      return json({ error: "Too many requests" }, { status: 429 });
    }
    const { postId, commentId } = await ctx.params;
    if (!postId) return json({ error: "postId is required" }, 400);
    if (!commentId) return json({ error: "commentId is required" }, 400);
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const action =
      body.action === "like" || body.action === "dislike" || body.action === "none"
        ? body.action
        : undefined;
    const value = body.value === "like" || body.value === "dislike" ? body.value : undefined;
    if (!action && !value) {
      return json({ error: "value (like|dislike) or action (like|dislike|none) is required" }, 400);
    }
    const baselineRaw = body.baseline as
      | { likes?: number; yourLike?: "like" | "dislike" | null }
      | undefined;
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
    const result = await proxyPostCommentLike(postId, commentId, {
      value,
      action,
      baseline,
      ...(commentText ? { commentText } : {}),
    });
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
