import { NextResponse } from "next/server";
import { getNetflixTitlePage } from "@/lib/netflix/catalog";
import { rateLimit } from "@/lib/youtube/cache";
import { netflixViewerId } from "@/lib/netflix/viewer";

export const dynamic = "force-dynamic";

/**
 * GET /api/netflix/title/[id] — the title page payload (P42): the title (live
 * pool → mirror fallback), where-it-ranks, same-pool neighbors, and the
 * viewer's My-List state. 404 honestly when the id is not in the tracked
 * universe (the Top 10 universe IS the honest catalog scope — ADR 0002).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!(await rateLimit(`netflix:title:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const { id } = await ctx.params;
    const netflixId = Number(id);
    if (!Number.isInteger(netflixId) || netflixId <= 0 || String(netflixId).length > 10) {
      return NextResponse.json({ error: "Invalid Netflix title id" }, { status: 400 });
    }
    const viewerId = await netflixViewerId(req);
    const page = await getNetflixTitlePage(netflixId, viewerId || null);
    if (!page) {
      return NextResponse.json(
        { error: "Title not in the tracked Netflix catalog" },
        { status: 404 }
      );
    }
    return NextResponse.json(page);
  } catch (err) {
    console.error("GET /api/netflix/title/[id] failed", err);
    return NextResponse.json({ error: "Failed to load the title" }, { status: 502 });
  }
}
