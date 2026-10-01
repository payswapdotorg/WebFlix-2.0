import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { proxyPostCommentCreate } from "@/lib/community/action-proxy";
import { getPostComments, getPostCommentReplies } from "@/lib/youtube/community";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/** A community post's comment-length limit (the composer's char counter). */
export const MAX_POST_COMMENT_LENGTH = 10_000;

/**
 * GET /api/posts/[postId]/comments?sort=top|new&cursor=&parentId= — the
 * post's comments through the SAME continuation walking the watch page uses
 * (the post detail browse carries the comment-item-section token; the sort
 * menu's Top/Newest tokens; pages map through the one comment mapper).
 * Walled upstream → the honest `{items: [], walled: true}` degrade the UI
 * shows as "unavailable", never a fake zero-comment post.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ postId: string }> }) {
  try {
    if (!(await rateLimit(`post-comments:${req.headers.get("x-forwarded-for") ?? "local"}`, { limit: 120 }))) {
      return json({ error: "Too many requests" }, { status: 429 });
    }
    const { postId } = await ctx.params;
    if (!postId) return json({ error: "postId is required" }, 400);
    const url = new URL(req.url);
    const sort = url.searchParams.get("sort") === "new" ? "new" : "top";
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const parentId = url.searchParams.get("parentId") ?? undefined;

    if (parentId) {
      const page = await getPostCommentReplies(postId, parentId, cursor);
      return json({
        items: page.items,
        nextCursor: page.nextCursor,
        ...(page.walled ? { walled: true } : {}),
      });
    }
    const page = await getPostComments(postId, sort, cursor);
    return json({
      items: page.items,
      nextCursor: page.nextCursor,
      total: page.total,
      ...(page.walled ? { walled: true } : {}),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST /api/posts/[postId]/comments {body | text} — LIVE Tier-2 write
 * (broker post-comment-create: the real comments composer on
 * youtube.com/post/<postId>). The response keeps the CommentDto contract the
 * composer expects (synthesized — the comment's real id/author arrive on the
 * next live read).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ postId: string }> }) {
  try {
    const { postId } = await ctx.params;
    if (!postId) return json({ error: "postId is required" }, 400);
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const textRaw = body.body ?? body.text;
    const text = typeof textRaw === "string" ? textRaw.trim() : "";
    if (!text) return json({ error: "body is required" }, 400);
    if (text.length > MAX_POST_COMMENT_LENGTH) {
      return json({ error: `body must be ≤ ${MAX_POST_COMMENT_LENGTH} chars` }, 400);
    }
    const viewer = await resolveViewer(req.headers);
    const comment = await proxyPostCommentCreate(postId, text, viewer);
    return json(comment, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
