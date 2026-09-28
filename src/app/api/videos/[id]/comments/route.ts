import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { listComments, createComment } from "@/lib/watch/comment-service";
import { commentsQuerySchema, commentCreateBodySchema } from "@/lib/watch/validators";

export const dynamic = "force-dynamic";

/**
 * GET /api/videos/[id]/comments?sort=top|new&cursor=&parentId=
 * — top-level pages (pinned first; 10/page; first 3 replies inline), or a
 * flat reply page under parentId (oldest first).
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
 * POST /api/videos/[id]/comments {body, parentId?} — composer + replies;
 * moderation default approved.
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
