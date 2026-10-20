import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/youtube/cache";
import { getMusicDestinationShelves } from "@/lib/youtube/music-destination";
import { hasSession } from "@/lib/youtube/session";
import type { MusicDestinationDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/music — the music destination's shelf family (P30, the
 * podcasts-destination route's sibling): one REAL search first page per
 * Music seed query (the SAME cached pages the category compose reads),
 * kept per-shelf so the page reads as shelves like youtube.com's own Music
 * destination. The surface is one page — no continuation (the same honest
 * no-sentinel law as /podcasts). `source` labels the data path;
 * `publicMode` tells the UI the operator YouTube session is absent.
 */
export async function GET(req: Request) {
  try {
    if (!(await rateLimit(`music:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const shelves = await getMusicDestinationShelves();
    const data: MusicDestinationDTO = {
      title: "Music",
      shelves,
      source: "search",
      publicMode: !hasSession(),
    };
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/music failed", err);
    return NextResponse.json({ error: "Failed to load music shelves" }, { status: 502 });
  }
}
