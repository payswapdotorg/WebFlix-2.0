import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { editComment, deleteComment } from "@/lib/watch/comment-service";
import { commentEditBodySchema } from "@/lib/watch/validators";

export const dynamic = "force-dynamic";

/** PATCH /api/comments/[id] {body} — edit own comment (inline). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewer = await resolveViewer(req.headers);
    const body = commentEditBodySchema.parse(await req.json());
    const comment = await editComment(id, viewer.id, body.body);
    return json(comment);
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/comments/[id] — soft-delete own comment (undo toast restores). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewer = await resolveViewer(req.headers);
    const result = await deleteComment(id, viewer.id);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
