import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { listLiveReplies, attachInlineReplies } from "@/lib/youtube/comments";
import { listLocalReplies, shadowUserId } from "@/lib/watch/local-comments";
import { resolveViewer } from "@/lib/watch/session";
import { getSessionUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/videos/[id]/comments/[commentId]/replies?cursor= — the replies
 * page under one comment (nested continuation tokens; the commentId anchors
 * the thread, the cursor pages through it). WFX2-P6-CR: when the live
 * thread has nothing, the honest WebFlix store's replies serve here
 * (local:true disclosed) — a local parent, or a YouTube parent whose thread
 * never loaded.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    const { id, commentId } = await ctx.params;
    if (!(await rateLimit(`replies:${req.headers.get("x-forwarded-for") ?? "local"}`, { limit: 240 }))) {
      return json({ error: "Too many requests" }, { status: 429 });
    }
    const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;
    const page = await listLiveReplies(id, commentId, cursor);
    let items = await attachInlineReplies(id, page.items);
    if (items.length === 0) {
      const viewer = await resolveViewer(req.headers);
      const sessionUser = await getSessionUser(req);
      const viewerIds = [
        ...new Set(
          [viewer.id, ...(sessionUser ? [shadowUserId(sessionUser.id)] : [])].filter(Boolean)
        ),
      ];
      const local = await listLocalReplies(id, commentId, viewerIds);
      if (local.items.length > 0) items = local.items;
    }
    return json({ items, nextCursor: page.nextCursor });
  } catch (e) {
    return errorResponse(e);
  }
}
