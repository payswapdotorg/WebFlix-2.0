import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { reportComment } from "@/lib/watch/comment-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/comments/[id]/report — flags the comment; it disappears from the
 * default (approved) view immediately.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewer = await resolveViewer(req.headers);
    const result = await reportComment(id, viewer.id);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
