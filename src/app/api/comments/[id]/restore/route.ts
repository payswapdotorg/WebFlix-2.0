import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { restoreComment } from "@/lib/watch/comment-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/comments/[id]/restore — undo for the delete toast (own comments).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewer = await resolveViewer(req.headers);
    const comment = await restoreComment(id, viewer.id);
    return json(comment);
  } catch (e) {
    return errorResponse(e);
  }
}
