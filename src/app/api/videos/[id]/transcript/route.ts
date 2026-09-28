import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { getTranscript } from "@/lib/watch/transcript-service";

export const dynamic = "force-dynamic";

/** GET /api/videos/[id]/transcript — cue rows, ordered. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const cues = await getTranscript(id);
    return json({ cues });
  } catch (e) {
    return errorResponse(e);
  }
}
