import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { saveProgress } from "@/lib/watch/progress-service";
import { progressBodySchema } from "@/lib/watch/validators";

export const dynamic = "force-dynamic";

/**
 * POST /api/videos/[id]/progress {watchedSec, lastPositionSec} — the 5s
 * auto-save from the player; powers resume-on-load.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewer = await resolveViewer(req.headers);
    const body = progressBodySchema.parse(await req.json());
    const result = await saveProgress(id, viewer.id, body.watchedSec, body.lastPositionSec);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
