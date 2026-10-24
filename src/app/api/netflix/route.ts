import { NextResponse } from "next/server";
import { getNetflixHome } from "@/lib/netflix/catalog";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/netflix?country= — the Netflix hub payload (P42). Rails compose
 * from the 8 bounded Tudum Top 10 pools through the shared cache; pools that
 * fail drop out honestly (`unavailable` + reason — never fake rows, ADR 0002
 * §3). `country` re-ranks rails for any ISO code the pools carry (~93);
 * default Global.
 */
export async function GET(req: Request) {
  try {
    if (!(await rateLimit(`netflix:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const raw = new URL(req.url).searchParams.get("country") ?? "Global";
    const country = /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : "Global";
    const home = await getNetflixHome(country);
    return NextResponse.json(home);
  } catch (err) {
    console.error("GET /api/netflix failed", err);
    return NextResponse.json({ error: "Failed to load the Netflix hub" }, { status: 502 });
  }
}
