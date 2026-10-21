import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/youtube/livechat";
import { cachedResilient, TTL } from "@/lib/youtube/cache";
import { getShortMeta, type ShortMetaDTO } from "@/lib/youtube/shorts";
import { resolveReadTier } from "@/lib/watch/action-proxy";
import { officialGetRating } from "@/lib/youtube/official-actions";

/**
 * WFX2-A-S — per-short engagement metadata.
 *
 * GET /api/shorts/[id] → next{videoId} mapped: title, channel, views text,
 * likes text, comments count text + the FIRST comments page (comments
 * continuation walking — same pattern as the A-B lane's comments, kept
 * local per lane rules; no A-B imports).
 *
 * WFX2-C-W: cached through the Upstash adapter (10-minute soft TTL,
 * stale-while-revalidate, last-good). A null meta (unavailable short) is
 * never cached over a good one; with no last-good the honest 404 stands.
 *
 * WFX2-P36 — the per-user state overlay: the CACHED meta carries no
 * per-user state; when the requesting user has their OWN connected account,
 * `yourLike` overlays from videos.getRating (their truth, 1 quota unit —
 * never the operator session's).
 */

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) {
    return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
  }
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local";
  if (!(await rateLimit(`shorts-meta:${ip}`, 60, 1))) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const headers = { "Cache-Control": "private, max-age=120" } as const;
  try {
    const [meta, tier] = await Promise.all([
      cachedResilient<ShortMetaDTO | null>(
        `shorts:meta:${id}`,
        TTL.SHORTS_META_MS,
        () => getShortMeta(id),
        { isEmpty: (m) => m === null },
      ),
      resolveReadTier(req),
    ]);
    if (!meta) {
      return NextResponse.json(
        { error: "Short metadata unavailable" },
        { status: 404 },
      );
    }
    if (tier) {
      const rating = await officialGetRating(tier.accessToken, id);
      meta.yourLike = rating.ok
        ? rating.data.rating === "like"
          ? "like"
          : rating.data.rating === "dislike"
            ? "dislike"
            : null
        : null;
    }
    return NextResponse.json(meta, { headers });
  } catch {
    return NextResponse.json(
      { error: "Short metadata unavailable" },
      { status: 404 },
    );
  }
}
