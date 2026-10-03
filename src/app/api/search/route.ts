import { NextResponse } from "next/server";
import { searchYouTube } from "@/lib/youtube/search";
import { parseSearchFilters } from "@/lib/youtube/filters";
import { rateLimit } from "@/lib/youtube/cache";
import { decodeSearchCursor, encodeCursor } from "@/lib/youtube/cursors";
import type { SearchPageDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/search?q=&sort=&date=&type=&duration=&live=&verbatim=&cursor= — live
 * youtube.com search (InnerTube) with the verified filter params encoding.
 * sort: relevance|date|views|rating · date: hour|today|week|month|year (the
 * `uploadDate` key is accepted as the A-B-era alias) · duration:
 * short|medium|long · type: video|channel|playlist|shorts|movie · live: 1
 * (Features→Live) · verbatim: 1 (skip spell autocorrection).
 * WFX2-B-W: the response carries playlists, resultCountText, correction.
 * WFX2-P6-IS: `cursor=` pages the results infinitely — an opaque envelope
 * around the search continuation token (the filtered query's chain is baked
 * into the token, so a cursor never crosses filters). First pages are cached
 * through the Upstash adapter; continuation pages ride their own unique
 * keys. A garbage cursor answers the honest 400 — never a 500.
 */
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const q = (params.get("q") ?? "").trim();
    const rawCursor = params.get("cursor");
    const cursor = rawCursor ? decodeSearchCursor(rawCursor) : null;
    if (rawCursor !== null && !cursor) {
      return NextResponse.json({ error: "Invalid search cursor" }, { status: 400 });
    }
    if (!q && !cursor) {
      const empty: SearchPageDTO = {
        query: q,
        videos: [],
        channels: [],
        playlists: [],
        resultCountText: null,
        correction: null,
        nextCursor: null,
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
    const results = await searchYouTube(q, filters, cursor?.t);
    const data: SearchPageDTO = {
      query: results.query,
      videos: results.videos,
      channels: results.channels,
      playlists: results.playlists,
      resultCountText: results.resultCountText,
      correction: results.correction,
      nextCursor: results.nextCursor ? encodeCursor({ s: "page", t: results.nextCursor }) : null,
    };
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/search failed", err);
    return NextResponse.json({ error: "Search failed — try again" }, { status: 502 });
  }
}
