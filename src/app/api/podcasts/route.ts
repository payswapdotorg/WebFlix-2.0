import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/youtube/cache";
import { getPodcastsPage } from "@/lib/youtube/podcasts";
import { hasSession } from "@/lib/youtube/session";
import type { PodcastsPageDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/podcasts — youtube.com's own podcasts destination (P25 G13),
 * the FEpodcasts_destination page read through the SSR mechanism (the
 * trending read's sibling — the InnerTube browse form answers 400 from
 * this egress, measured 2026-10-19; the served HTML is the real seam).
 * The surface is one page: the header + the shelf family, ZERO
 * continuation anywhere in the measured payload (never a fabricated
 * scroll). `source` labels the data path; `publicMode` tells the UI the
 * operator YouTube session is absent (the honest-label discipline).
 */
export async function GET(req: Request) {
  try {
    if (!(await rateLimit(`podcasts:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const page = await getPodcastsPage();
    const data: PodcastsPageDTO = {
      title: page.title,
      shelves: page.shelves,
      source: "ssr",
      publicMode: !hasSession(),
    };
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/podcasts failed", err);
    return NextResponse.json({ error: "Failed to load podcasts" }, { status: 502 });
  }
}
