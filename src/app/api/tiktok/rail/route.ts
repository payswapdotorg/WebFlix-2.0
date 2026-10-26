import { NextResponse } from "next/server";
import { getTikTokRail } from "@/lib/tiktok/library";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/tiktok/rail — the TikTok hub payload (P58, ADR 0004): the curated
 * universe with every post honestly resolved through the keyless oEmbed lane.
 * A walled egress degrades to honest unavailable cards (the embed players
 * themselves ride the viewer's browser and keep working) — never fake rows.
 */
export async function GET(req: Request) {
  try {
    if (!(await rateLimit(`tiktok:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const rail = await getTikTokRail();
    // oEmbed answers move on the 6h/24h cache TTLs — the same short shared
    // cache (+ SWR) their Netflix siblings run (P51-AUDIT S4 doctrine).
    return NextResponse.json(rail, {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=86400" },
    });
  } catch (err) {
    console.error("GET /api/tiktok/rail failed", err);
    return NextResponse.json({ error: "Failed to load the TikTok shelf" }, { status: 502 });
  }
}
