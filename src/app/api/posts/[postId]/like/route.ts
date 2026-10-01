import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyPostLike } from "@/lib/community/action-proxy";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * POST /api/posts/[postId]/like — LIVE Tier-2 write (broker post-like: the
 * real vote toggle on youtube.com/post/<postId>, aria-pressed verified).
 *
 * Request (the comment-like shapes, kept):
 *   { action: "like" | "dislike" | "none" }   canonical — set semantics
 *   { value: "like" | "dislike" }             legacy — toggle semantics
 *   { baseline?: { likes, yourLike } }
 *
 * Response: { ok, effect, likes, yourLike } — the PostLikeResult contract
 * the post cards consume. Broker offline → the honest 502 shape the UI
 * degrades on (toast + state rollback), never a fake success.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ postId: string }> }) {
  try {
    if (!(await rateLimit(`post-like:${req.headers.get("x-forwarded-for") ?? "local"}`, { limit: 60 }))) {
      return json({ error: "Too many requests" }, { status: 429 });
    }
    const { postId } = await ctx.params;
    if (!postId) return json({ error: "postId is required" }, 400);
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
    const value =
      body.value === "like" || body.value === "dislike" ? body.value : undefined;
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
    const result = await proxyPostLike(postId, { value, action, baseline });
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
