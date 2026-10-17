import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/youtube/cache";
import { getWatchQueue, isMixListId, type WatchQueueDto } from "@/lib/youtube/watch-queue";
import { parseShuffleSeedParam, seededShuffle } from "@/lib/playlist/shuffle";

export const dynamic = "force-dynamic";

/**
 * REA-1 G16/G19 — GET /api/watch/queue?videoId=…&list=…[&shuffle=…][&cursor=…]
 *
 * The watch-page playlist queue (youtube.com's own seam, measured live
 * 2026-10-17): `next {videoId, playlistId}` builds the queue panel for
 * regular playlists (list order) AND mixes (RD… — YouTube's own shuffled
 * order, isInfinite); the special lists (WL/LL) ride the session read with
 * the honest P22-B states. The deterministic seeded shuffle is applied HERE,
 * over the fetched page — local playback-order logic, no YouTube write.
 *
 * `cursor` pages the infinite autoload (continuation items append AFTER the
 * possibly-shuffled first page — the seed never re-applies, exactly the
 * work-order law: the shuffle is over the already-fetched list).
 */
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const videoId = params.get("videoId") ?? "";
    const listId = params.get("list") ?? "";
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
      return NextResponse.json({ error: "A valid videoId is required" }, { status: 400 });
    }
    if (!listId || !/^(?:PL|RD|OL|UU|FL|LL|WL)[A-Za-z0-9_-]{0,}$/.test(listId)) {
      return NextResponse.json({ error: "A valid list is required" }, { status: 400 });
    }
    const cursor = params.get("cursor");
    const seed = parseShuffleSeedParam(params.get("shuffle"));

    if (!(await rateLimit(`watch-queue:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const queue = await getWatchQueue(videoId, listId, cursor ?? undefined);
    if (!queue) {
      // the honest no-panel answer (measured: WL/LL via `next` signed-out
      // carry no panel; a list YouTube will not queue for this video either)
      return NextResponse.json({ error: "Queue unavailable for this list" }, { status: 404 });
    }

    let dto: WatchQueueDto = queue;
    // the deterministic local shuffle: playlists, curated lists AND the
    // special lists (WL/LL — the work order's explicit contract) — all
    // locally shuffle over the fetched read. ONLY a true mix/radio (the
    // seed-carrying RD family — measured) arrives in YouTube's OWN shuffled
    // order and is never re-shuffled locally; continuation pages append
    // after the shuffled first page (the seed never re-applies — the law).
    const shuffled = seed !== null && cursor === null && !isMixListId(listId);
    if (shuffled && seed !== null) {
      dto = { ...queue, items: seededShuffle(queue.items, seed) };
    }

    // the now-playing position: the caller's video located in the FINAL
    // order (post-shuffle) — -1 when this video is not in the served page
    const currentIndex = dto.items.findIndex((it) => it.videoId === videoId);

    return NextResponse.json({ ...dto, currentIndex, shuffled });
  } catch (err) {
    console.error("GET /api/watch/queue failed", err);
    return NextResponse.json({ error: "Failed to load the queue" }, { status: 502 });
  }
}
