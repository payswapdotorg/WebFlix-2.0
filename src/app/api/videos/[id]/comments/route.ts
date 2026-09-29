import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { listComments } from "@/lib/watch/comment-service";
import { proxyCommentCreate, proxyCommentReply } from "@/lib/watch/action-proxy";
import { commentsQuerySchema } from "@/lib/watch/validators";

export const dynamic = "force-dynamic";

/**
 * GET /api/videos/[id]/comments?sort=top|new&cursor=&parentId=
 * — read lane unchanged (seed-backed until the InnerTube swap merges).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewer = await resolveViewer(req.headers);
    const url = new URL(req.url);
    const query = commentsQuerySchema.parse({
      sort: url.searchParams.get("sort") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      parentId: url.searchParams.get("parentId") ?? undefined,
    });
    const page = query.parentId
      ? await listComments(id, viewer.id, query.sort, query.cursor, query.parentId)
      : await listComments(id, viewer.id, query.sort, query.cursor);
    return json(page);
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST /api/videos/[id]/comments {body, parentId?, parentText?} — LIVE
 * Tier-2 write (broker comment-create / comment-reply — the comment
 * composer's path).
 *
 * The broker posts the comment through the logged-in YouTube tab (the
 * simplebox → editor → submit UI path), so the effect is identical to
 * commenting on youtube.com. The response keeps the CommentDto contract the
 * composer expects (the DTO is synthesized — the comment's real id/author
 * come from YouTube on the next live read). parentText (optional) enables
 * the broker's DOM-locator UI path for replies.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewer = await resolveViewer(req.headers);
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!text) return json({ error: "body is required" }, 400);
    if (text.length > 5000) return json({ error: "body must be ≤ 5000 chars" }, 400);
    const parentId = typeof body.parentId === "string" && body.parentId ? body.parentId : undefined;
    const parentText =
      typeof body.parentText === "string" && body.parentText ? body.parentText : undefined;

    const comment = parentId
      ? await proxyCommentReply(id, parentId, text, viewer, parentText)
      : await proxyCommentCreate(id, text, viewer);
    return json(comment, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
