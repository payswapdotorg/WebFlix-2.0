import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { getVideoDetail, registerView } from "@/lib/watch/video-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/videos/[id] — the watch payload: video + channel + viewer state,
 * with a view increment (deduped per user+video per hour).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewer = await resolveViewer(req.headers);
    await registerView(id, viewer.id);
    const detail = await getVideoDetail(id, viewer.id);
    return json(detail);
  } catch (e) {
    return errorResponse(e);
  }
}
