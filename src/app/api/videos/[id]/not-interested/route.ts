import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { markNotInterested } from "@/lib/watch/video-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/videos/[id]/not-interested — the kebab "Not interested" action;
 * hides the video from this viewer's related rail.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewer = await resolveViewer(req.headers);
    const result = await markNotInterested(id, viewer.id);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
