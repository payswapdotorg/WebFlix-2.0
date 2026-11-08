/**
 * P102 — GET /api/tiktok/live/board: the honest live board (G27). ONE
 * batched status run answers the whole tracked universe (the curated
 * authors + the public import authors — the SAME composition the feed
 * follows). Answers, honestly:
 *  - 200 { board } — the cached board (rooms + missing, liveness TTL);
 *  - 200 { board: stale } — P102-R2 (the SWR law): an expired-but-present
 *    board is SERVED while the refresh rides after() — a warm hub never
 *    flashes back to probing;
 *  - 200 { board: probing } — a COLD universe's batch run is in flight (the
 *    client keeps polling; probing is NEVER rendered as an empty board);
 *  - 503 { error } — the probe lane is unconfigured (names the enable path);
 *  - 502 { error } — the batch run failed upstream (the real reason).
 * No client-supplied handle list: the universe composition is server law,
 * and the request surface never becomes a spend amplifier.
 */
import { NextResponse } from "next/server";
import { after } from "next/server";

import {
  isTikTokLiveBoardBackedOff,
  isTikTokLiveBoardInFlight,
  isTikTokLiveProbeLaneConfigured,
  mergeTikTokLiveBoard,
  probeTikTokLiveBoard,
  readTikTokLiveBoardBackoff,
  readTikTokLiveBoardEntry,
  tiktokLivePinnedHandles,
  type TikTokLiveBoardDTO,
} from "@/lib/tiktok/live";
import { creatorHandleFromVideo } from "@/lib/tiktok/channels";
import { getTikTokRail } from "@/lib/tiktok/library";

export const dynamic = "force-dynamic";

/** The universe composition (P102-R4): the pinned live creators ride FIRST
 * (the product's canonical live creators — answered within the batch even
 * when the actor caps rows), then the feed's rail authors. The batch
 * normalizer dedupes and caps downstream. */
async function universeHandles(): Promise<string[]> {
  const handles = tiktokLivePinnedHandles();
  const rail = await getTikTokRail();
  for (const video of rail.videos ?? []) {
    const handle = creatorHandleFromVideo(video);
    if (handle) handles.push(handle);
  }
  return handles;
}

function scheduleBoardProbe(handles: string[]): void {
  const run = () =>
    probeTikTokLiveBoard(handles).catch((err) => {
      console.error("tiktok live board probe failed", err);
    });
  try {
    after(run);
  } catch {
    void run();
  }
}

function probingBoard(): TikTokLiveBoardDTO {
  return { rooms: [], missing: [], probing: true, fetchedAt: new Date().toISOString() };
}

export async function GET(): Promise<NextResponse> {
  const handles = await universeHandles();
  if (handles.length === 0) {
    // the honest empty: an empty universe is a real answer, not a probe spend
    return NextResponse.json(
      { board: { rooms: [], missing: [], fetchedAt: new Date().toISOString() } },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  // P102-R2 — the SWR read: fresh AND stale boards are served (a warm hub
  // never flashes back to probing); only a COLD universe reaches the probe
  // path below.
  const entry = readTikTokLiveBoardEntry(handles);
  if (entry) {
    if (
      !entry.fresh &&
      !isTikTokLiveBoardInFlight(handles) &&
      !isTikTokLiveBoardBackedOff(handles)
    ) {
      // P103-mini-3 — a backed-off lane never re-probes (no hammering);
      // the stale board keeps serving (a warm hub never goes dark).
      scheduleBoardProbe(handles);
    }
    // P102-R3 — the merge law: fresh live answers the per-handle cache holds
    // fold into the served board (the batch actor empirically drops rows;
    // zero extra spend — every merged row is a real probe's answer).
    const served = mergeTikTokLiveBoard(entry.board);
    return NextResponse.json(
      { board: entry.fresh ? served : { ...served, stale: true } },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  if (!isTikTokLiveProbeLaneConfigured()) {
    return NextResponse.json(
      {
        error:
          "The TikTok live probe lane is not configured — set APIFY_API_KEY (see .env.example).",
      },
      { status: 503 }
    );
  }
  // P103-mini-3 — the failure-surfacing law: a COLD universe whose batch
  // run recently FAILED serves the REAL error (the room page's 60s-backoff
  // law, board edition) instead of probing forever. After the window the
  // marker is consumed and the retry law takes over (probing again).
  const failure = readTikTokLiveBoardBackoff(handles);
  if (failure) {
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
  if (!isTikTokLiveBoardInFlight(handles)) {
    scheduleBoardProbe(handles);
  }
  return NextResponse.json({ board: probingBoard() }, { headers: { "Cache-Control": "no-store" } });
}
