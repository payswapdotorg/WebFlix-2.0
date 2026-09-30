import { NextResponse } from "next/server";
import { searchYouTube } from "@/lib/youtube/search";
import { parseSearchFilters } from "@/lib/youtube/filters";
import { rateLimit } from "@/lib/youtube/cache";
import type { SearchPageDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/search?q=&sort=&date=&type=&duration=&live=&verbatim= — live
 * youtube.com search (InnerTube) with the verified filter params encoding.
 * sort: relevance|date|views|rating · date: hour|today|week|month|year (the
 * `uploadDate` key is accepted as the A-B-era alias) · duration:
 * short|medium|long · type: video|channel|playlist|shorts|movie · live: 1
 * (Features→Live) · verbatim: 1 (skip spell autocorrection).
 * WFX2-B-W: the response carries playlists, resultCountText, correction.
 */
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const q = (params.get("q") ?? "").trim();
    if (!q) {
      const empty: SearchPageDTO = {
        query: q,
        videos: [],
        channels: [],
        playlists: [],
        resultCountText: null,
        correction: null,
      };
      return NextResponse.json(empty);
    }
    if (!(await rateLimit(`search:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many searches — slow down" }, { status: 429 });
    }
    const filters = parseSearchFilters({
      sort: params.get("sort"),
      uploadDate: params.get("date") ?? params.get("uploadDate"),
      duration: params.get("duration"),
      type: params.get("type"),
      live: params.get("live"),
      verbatim: params.get("verbatim"),
    });
    const results = await searchYouTube(q, filters);
    const data: SearchPageDTO = {
      query: results.query,
      videos: results.videos,
      channels: results.channels,
      playlists: results.playlists,
      resultCountText: results.resultCountText,
      correction: results.correction,
    };
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/search failed", err);
    return NextResponse.json({ error: "Search failed — try again" }, { status: 502 });
  }
}
