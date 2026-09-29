import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { resolveViewer } from "@/lib/watch/session";
import { getRelated } from "@/lib/watch/video-service";
import { relatedQuerySchema } from "@/lib/watch/validators";

export const dynamic = "force-dynamic";

/**
 * GET /api/videos/[id]/related?cursor=&limit= — related rail page
 * (same category first, then views desc, excluding current).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const viewer = await resolveViewer(req.headers);
    const url = new URL(req.url);
    const query = relatedQuerySchema.parse({
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    const page = await getRelated(id, viewer.id, query.cursor, query.limit);
    return json(page);
  } catch (e) {
    return errorResponse(e);
  }
}
