import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { proxyCommentCreate, proxyCommentReply } from "@/lib/watch/action-proxy";
import { listLiveComments, attachInlineReplies } from "@/lib/youtube/comments";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/videos/[id]/comments?sort=top|new&cursor=&parentId= — LIVE
 * comments via InnerTube continuation walking (20/page; sort tokens from the
 * response's own sort menu). `parentId` serves the UI's reply threads; the
 * dedicated nested replies route serves the same data for later waves.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!rateLimit(`comments:${req.headers.get("x-forwarded-for") ?? "local"}`, { limit: 240 })) {
      return json({ error: "Too many requests" }, { status: 429 });
    }
    const url = new URL(req.url);
    const sort = url.searchParams.get("sort") === "new" ? "new" : "top";
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const parentId = url.searchParams.get("parentId") ?? undefined;

    if (parentId) {
      // reply page under one comment (existing UI thread expander)
      const { listLiveReplies } = await import("@/lib/youtube/comments");
      const page = await listLiveReplies(id, parentId, cursor);
      const withInline = await attachInlineReplies(id, page.items);
      return json({ items: withInline, nextCursor: page.nextCursor });
    }

    const page = await listLiveComments(id, sort, cursor);
    const items = await attachInlineReplies(id, page.items);
    return json({ items, nextCursor: page.nextCursor, total: page.total });
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
