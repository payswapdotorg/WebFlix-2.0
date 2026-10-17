import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/youtube/cache";
import { getHashtagPage } from "@/lib/youtube/hashtags";

export const dynamic = "force-dynamic";

/**
 * REA-1 G17 — GET /api/hashtag/[tag]?cursor=… — the hashtag browse pages
 * (youtube.com's /hashtag/<tag> surface, measured live 2026-10-17): the
 * FEhashtag InnerTube browse (the same read youtube.com's own hashtag links
 * carry — browseId FEhashtag + the tag-encoded params protobuf) → the
 * header meta + the real video grid + the continuation chain.
 *
 * Honest degradation law: an upstream failure answers the honest 502 — the
 * page renders the honest status-note family, never a fabricated grid.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ tag: string }> }
) {
  try {
    const { tag: rawTag } = await params;
    const tag = decodeURIComponent(rawTag);
    if (!tag || tag.length > 100 || /^#/.test(tag)) {
      return NextResponse.json({ error: "Unknown hashtag" }, { status: 404 });
    }
    const cursor = new URL(req.url).searchParams.get("cursor");
    if (cursor !== null && !/^[A-Za-z0-9_-]{8,}$/.test(cursor)) {
      return NextResponse.json({ error: "Invalid hashtag cursor" }, { status: 400 });
    }
    if (!(await rateLimit(`hashtag:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const page = await getHashtagPage(tag, cursor ?? undefined);
    return NextResponse.json(page);
  } catch (err) {
    console.error("GET /api/hashtag/[tag] failed", err);
    return NextResponse.json({ error: "Failed to load hashtag videos" }, { status: 502 });
  }
}
