import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { reportVideo } from "@/lib/watch/video-service";
import { reportBodySchema } from "@/lib/watch/validators";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/videos/[id]/report {reason} — sends the video to the moderation
 * review queue (video stays visible, matching youtube.com).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    const { id } = await ctx.params;
    const viewer = await resolveViewer(req.headers);
    const body = reportBodySchema.parse(await req.json());
    const result = await reportVideo(id, viewer.id, body.reason);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
