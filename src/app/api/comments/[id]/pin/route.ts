import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { pinComment } from "@/lib/watch/comment-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/comments/[id]/pin — creator pin toggle (only the video channel's
 * owner). Pinned comments stay first in both sort modes.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewer = await resolveViewer(req.headers);
    const result = await pinComment(id, viewer.id);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
