import { NextRequest, NextResponse } from "next/server";
import { cacheGet, cacheSet, rateLimit } from "@/lib/youtube/livechat";
import { getShortMeta, type ShortMetaDTO } from "@/lib/youtube/shorts";

/**
 * WFX2-A-S — per-short engagement metadata.
 *
 * GET /api/shorts/[id] → next{videoId} mapped: title, channel, views text,
 * likes text, comments count text + the FIRST comments page (comments
 * continuation walking — same pattern as the A-B lane's comments, kept
 * local per lane rules; no A-B imports). Cached 10 minutes per short.
 */

export const dynamic = "force-dynamic";

const META_TTL_MS = 10 * 60 * 1000;

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
  if (!rateLimit(`shorts-meta:${ip}`, 60, 1)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const cacheKey = `shorts:meta:${id}`;
  const cached = cacheGet<ShortMetaDTO>(cacheKey);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "private, max-age=120" },
    });
  }

  const meta = await getShortMeta(id);
  if (!meta) {
    return NextResponse.json(
      { error: "Short metadata unavailable" },
      { status: 404 },
    );
  }
  cacheSet(cacheKey, meta, META_TTL_MS);
  return NextResponse.json(meta, {
    headers: { "Cache-Control": "private, max-age=120" },
  });
}
