/**
 * P100-TIKTOK-LIVE — GET /api/tiktok/live?handle=<handle>: the live status
 * contract. Answers, honestly:
 *  - 200 { status } — the cached DTO (live true/false with real room data);
 *  - 200 { status: probing } — a COLD handle with a probe in flight (the
 *    client keeps polling; probing is NEVER rendered as offline);
 *  - 200 { status: stale } — P102-R2 (the SWR law): an expired-but-present
 *    answer is SERVED while the refresh probe rides after() — a warm room
 *    never goes dark (the P100 probing-flip unmounted rooms and playing
 *    videos every TTL cycle; measured live on prod);
 *  - 503 { error } — the probe lane is unconfigured (the error names the
 *    enable path, the connection-card doctrine);
 *  - 502 { error } — the probe lane failed upstream and NO last-known
 *    answer exists (failure backoff makes the next peek surface the real
 *    error for 60s; a warm handle is served its last-known data instead);
 *  - 400 — invalid handles (the G20 law: sigil soup normalizes, true
 *    garbage does not).
 * The probe itself rides `after()` so the response is never blocked by the
 * 60–90s Apify run (serverless-safe); outside a request scope (dev/tests)
 * it falls back to an inline fire-and-forget.
 */
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";

import {
  isTikTokLivePlaybackBackedOff,
  isTikTokLivePlaybackInFlight,
  isTikTokLiveProbeBackedOff,
  isTikTokLiveProbeInFlight,
  isTikTokLiveProbeLaneConfigured,
  probingTikTokLiveStatus,
  probeTikTokLivePlayback,
  probeTikTokLiveStatus,
  readTikTokLivePlaybackEntry,
  readTikTokLiveStatusEntry,
  TikTokLiveUnavailableError,
  type TikTokLiveStatusDTO,
  type TikTokLiveStreamInfo,
} from "@/lib/tiktok/live";
import { isTikTokHandle, normalizeTikTokHandle } from "@/lib/tiktok/urls";

export const dynamic = "force-dynamic";

function scheduleProbe(handle: string): void {
  const run = () =>
    probeTikTokLiveStatus(handle).catch((err) => {
      console.error(`tiktok live probe failed for @${handle}`, err);
    });
  try {
    // Serverless-safe: the probe continues after the response flushes.
    after(run);
  } catch {
    // No request scope (dev/bun tests): run inline instead of never.
    void run();
  }
}

/** P102 — the playback resolution rides after() exactly like the status probe. */
function schedulePlaybackProbe(handle: string): void {
  const run = () =>
    probeTikTokLivePlayback(handle).catch((err) => {
      console.error(`tiktok live playback probe failed for @${handle}`, err);
    });
  try {
    after(run);
  } catch {
    void run();
  }
}

/**
 * P102 — the playback composition (the cost law): ONLY a live room spends a
 * playback probe. A fresh OR stale cached stream rides (P102-R2: a stale
 * stream keeps the video mounted mid-watch — the player's own error →
 * fallback rung covers a genuinely dead URL); an in-flight resolution
 * answers `streamProbing: true` (the view shows "resolving the stream…",
 * never the fallback rung); a resting lane with no answer drops to the
 * honest fallback rung. Never blocks the response on the 20–35s actor run.
 */
async function composePlayback(handle: string, status: TikTokLiveStatusDTO): Promise<TikTokLiveStatusDTO> {
  if (status.live !== true || status.stream) return status;
  let entry: { stream: TikTokLiveStreamInfo; fresh: boolean } | null = null;
  try {
    entry = readTikTokLivePlaybackEntry(handle);
  } catch {
    // the playback lane rests in backoff with no answer — the fallback rung
    // answers honestly ("can't ride right now" + the outbound link)
    return status;
  }
  if (entry) {
    if (!entry.fresh && !isTikTokLivePlaybackInFlight(handle) && !isTikTokLivePlaybackBackedOff(handle)) {
      schedulePlaybackProbe(handle);
    }
    return { ...status, stream: entry.stream, streamProbing: false };
  }
  if (!isTikTokLivePlaybackInFlight(handle) && !isTikTokLivePlaybackBackedOff(handle)) {
    schedulePlaybackProbe(handle);
  }
  return { ...status, streamProbing: true };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const raw = req.nextUrl.searchParams.get("handle") ?? "";
  const handle = normalizeTikTokHandle(raw);
  if (!handle || !isTikTokHandle(handle)) {
    return NextResponse.json({ error: "Invalid TikTok handle" }, { status: 400 });
  }
  // P102-R2 — the SWR read: fresh AND stale entries are served; only a COLD
  // handle (no entry at all) reaches the probing path, and a cold handle in
  // backoff surfaces the REAL error.
  let entry: { dto: TikTokLiveStatusDTO; fresh: boolean } | null = null;
  try {
    entry = readTikTokLiveStatusEntry(handle);
  } catch (err) {
    const status = err instanceof TikTokLiveUnavailableError ? err.status : 502;
    const message =
      err instanceof Error ? err.message : "The TikTok live status is unavailable right now.";
    return NextResponse.json({ error: message }, { status });
  }
  if (entry) {
    if (!entry.fresh && !isTikTokLiveProbeInFlight(handle) && !isTikTokLiveProbeBackedOff(handle)) {
      scheduleProbe(handle);
    }
    const composed = await composePlayback(handle, entry.dto);
    return NextResponse.json(
      { status: entry.fresh ? composed : { ...composed, stale: true } },
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
  if (!isTikTokLiveProbeInFlight(handle)) {
    scheduleProbe(handle);
  }
  return NextResponse.json(
    { status: probingTikTokLiveStatus(handle) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
