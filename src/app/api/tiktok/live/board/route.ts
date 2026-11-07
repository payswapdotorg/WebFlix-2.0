/**
 * P102 — GET /api/tiktok/live/board: the honest live board (G27). ONE
 * batched status run answers the whole tracked universe (the curated
 * authors + the public import authors — the SAME composition the feed
 * follows). Answers, honestly:
 *  - 200 { board } — the cached board (rooms + missing, liveness TTL);
 *  - 200 { board: probing } — the batch run is in flight (the client keeps
 *    polling; probing is NEVER rendered as an empty board);
 *  - 503 { error } — the probe lane is unconfigured (names the enable path);
 *  - 502 { error } — the batch run failed upstream (the real reason).
 * No client-supplied handle list: the universe composition is server law,
 * and the request surface never becomes a spend amplifier.
 */
import { NextResponse } from "next/server";
import { after } from "next/server";

import {
  isTikTokLiveBoardInFlight,
  isTikTokLiveProbeLaneConfigured,
  peekTikTokLiveBoard,
  probeTikTokLiveBoard,
  TikTokLiveUnavailableError,
  type TikTokLiveBoardDTO,
} from "@/lib/tiktok/live";
import { creatorHandleFromVideo } from "@/lib/tiktok/channels";
import { getTikTokRail } from "@/lib/tiktok/library";

export const dynamic = "force-dynamic";

/** The universe composition (the feed's own law, reused): curated + imports. */
async function universeHandles(): Promise<string[]> {
  const rail = await getTikTokRail();
  const handles: string[] = [];
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
  try {
    const cached = await peekTikTokLiveBoard(handles);
    if (cached) {
      return NextResponse.json({ board: cached }, { headers: { "Cache-Control": "no-store" } });
    }
  } catch (err) {
    const status = err instanceof TikTokLiveUnavailableError ? err.status : 502;
    const message =
      err instanceof Error ? err.message : "The TikTok live board is unavailable right now.";
    return NextResponse.json({ error: message }, { status });
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
  if (!isTikTokLiveBoardInFlight(handles)) {
    scheduleBoardProbe(handles);
  }
  return NextResponse.json({ board: probingBoard() }, { headers: { "Cache-Control": "no-store" } });
}
