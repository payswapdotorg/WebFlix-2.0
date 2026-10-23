import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { proxyCommentLike } from "@/lib/watch/action-proxy";
import { findLocalActionRow, localLikeComment } from "@/lib/watch/local-comments";
import type { LikeValue } from "@/lib/watch/types";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/comments/[id]/like — two honest tiers (WFX2-P40):
 *  - a LOCAL row (the WebFlix store owns it) → the store-backed like
 *    (CommentLike toggle as the session's shadow user, local:true — the
 *    read path's viewerLikes lane finally has its write twin);
 *  - a YouTube comment (unknown id or a "shadow" anchor) → the HONEST
 *    UNSUPPORTED lane: liking YouTube comments has no official end-user
 *    API, and the pre-P36 broker DOM drive is retired with the shared
 *    operator identity — the proxy answers the honest 501 (kind
 *    "youtube-unsupported"), rendered verbatim by errorResponse (never a
 *    fake likes delta).
 *
 * Request (UI shapes kept):
 *   { value: "like" | "dislike" }               legacy — toggle semantics
 *   { action: "like" | "dislike" | "none" }     canonical — set semantics
 *   { baseline?: { likes, yourLike }, commentText?, videoId? }
 *
 * Response: local tier → 200 { ok, effect, likes, yourLike, path:"local",
 * local:true }; YouTube tier → 501 { error, kind: "youtube-unsupported" }.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return authRequiredResponse();
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
    // WFX2-P40 — the local-row tier first: a row the store owns gets a
    // store-backed like. The catch keeps a store outage on the honest
    // YouTube lane rather than a 500 (the tier lookup is best-effort).
    const localRow = await findLocalActionRow(id).catch(() => null);
    if (localRow) {
      const result = await localLikeComment(id, sessionUser, { value, action });
      return json(result);
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
