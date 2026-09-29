import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { listLiveReplies, attachInlineReplies } from "@/lib/youtube/comments";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/videos/[id]/comments/[commentId]/replies?cursor= — the replies
 * page under one comment (nested continuation tokens; the commentId anchors
 * the thread, the cursor pages through it).
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    const { id, commentId } = await ctx.params;
    if (!rateLimit(`replies:${req.headers.get("x-forwarded-for") ?? "local"}`, { limit: 240 })) {
      return json({ error: "Too many requests" }, { status: 429 });
    }
    const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;
    const page = await listLiveReplies(id, commentId, cursor);
    const items = await attachInlineReplies(id, page.items);
    return json({ items, nextCursor: page.nextCursor });
  } catch (e) {
    return errorResponse(e);
  }
}
