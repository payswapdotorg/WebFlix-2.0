import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { setCommentLike } from "@/lib/watch/like-service";
import { commentLikeBodySchema } from "@/lib/watch/validators";

export const dynamic = "force-dynamic";

/**
 * POST /api/comments/[id]/like {value} — like/dislike a comment; same value
 * toggles off; swap allowed. Only the like count is surfaced (YouTube).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewer = await resolveViewer(req.headers);
    const body = commentLikeBodySchema.parse(await req.json());
    const result = await setCommentLike(id, viewer.id, body.value);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
