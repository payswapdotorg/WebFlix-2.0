import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/watch/api";
import { cached, TTL, rateLimit } from "@/lib/youtube/cache";
import { watchResponse } from "@/lib/youtube/watch";
import { mapRelatedPage } from "@/lib/youtube/related";

export const dynamic = "force-dynamic";

/**
 * GET /api/videos/[id]/related?cursor=&limit= — the live related rail from
 * the watch `next` response's secondaryResults (lockupViewModel items; the
 * trailing continuation token is the cursor). limit is honored by slicing —
 * YouTube returns one rail page per continuation.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!rateLimit(`related:${req.headers.get("x-forwarded-for") ?? "local"}`, { limit: 240 })) {
      return json({ error: "Too many requests" }, { status: 429 });
    }
    const url = new URL(req.url);
    const limitParam = Number(url.searchParams.get("limit") ?? "8");
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 24) : 8;
    const cursor = url.searchParams.get("cursor") ?? undefined;

    let page: { items: ReturnType<typeof mapRelatedPage>["items"]; nextCursor: string | null };
    if (cursor) {
      const { innertubeNext } = await import("@/lib/youtube/innertube");
      const response = await innertubeNext({ continuation: cursor });
      page = mapRelatedPage(response);
    } else {
      const response = await cached(`yt:watch:${id}`, TTL.WATCH_MS, () => watchResponse(id));
      const full = mapRelatedPage(response);
      page = { items: full.items.slice(0, limit), nextCursor: full.nextCursor };
    }
    return json({ items: page.items, nextCursor: page.nextCursor });
  } catch (e) {
    return errorResponse(e);
  }
}
