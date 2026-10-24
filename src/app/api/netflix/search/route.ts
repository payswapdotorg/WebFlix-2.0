import { NextResponse } from "next/server";
import { searchNetflixCatalog } from "@/lib/netflix/catalog";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/netflix/search?q= — the Netflix catalog search (P42). Rides the
 * Prisma mirror the pools feed on every refresh; the honest scope note rides
 * in the DTO (the Top-10 universe, not the full Netflix catalog — research
 * record §5). Additive to the YouTube search lane, never a replacement.
 */
export async function GET(req: Request) {
  try {
    if (!(await rateLimit(`netflix:search:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 120);
    const results = await searchNetflixCatalog(q);
    return NextResponse.json(results);
  } catch (err) {
    console.error("GET /api/netflix/search failed", err);
    return NextResponse.json({ error: "Failed to search the Netflix catalog" }, { status: 502 });
  }
}
