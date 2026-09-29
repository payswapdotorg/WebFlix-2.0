import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { createComment } from "@/lib/watch/comment-service";
import { commentCreateBodySchema } from "@/lib/watch/validators";
import { listLiveComments, attachInlineReplies } from "@/lib/youtube/comments";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/videos/[id]/comments?sort=top|new&cursor=&parentId= — live
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
 * POST /api/videos/[id]/comments {body, parentId?} — comment creation is a
 * Tier-2 write (broker lane); the seed-backed demo path remains until that
 * lane lands. Reads above are fully live.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewer = await resolveViewer(req.headers);
    const body = commentCreateBodySchema.parse(await req.json());
    const comment = await createComment(id, viewer.id, body.body, body.parentId);
    return json(comment, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
