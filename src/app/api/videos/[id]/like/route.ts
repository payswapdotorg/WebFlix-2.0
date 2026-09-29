import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { setVideoLike } from "@/lib/watch/like-service";
import { videoLikeBodySchema } from "@/lib/watch/validators";

export const dynamic = "force-dynamic";

/**
 * POST /api/videos/[id]/like {value: "like"|"dislike"} — one like OR one
 * dislike per user; same value toggles off; other value swaps.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewer = await resolveViewer(req.headers);
    const body = videoLikeBodySchema.parse(await req.json());
    const result = await setVideoLike(id, viewer.id, body.value);
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
