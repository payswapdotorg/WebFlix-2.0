/**
 * P100-TIKTOK-LIVE — GET /api/tiktok/live?handle=<handle>: the live status
 * contract. Answers, honestly:
 *  - 200 { status } — the cached DTO (live true/false with real room data);
 *  - 200 { status: probing } — a probe is in flight (the client keeps
 *    polling; probing is NEVER rendered as offline);
 *  - 503 { error } — the probe lane is unconfigured (the error names the
 *    enable path, the connection-card doctrine);
 *  - 502 { error } — the probe lane failed upstream (failure backoff makes
 *    the next peek surface the real error for 60s);
 *  - 400 — invalid handles (the G20 law: sigil soup normalizes, true
 *    garbage does not).
 * The probe itself rides `after()` so the response is never blocked by the
 * 60–90s Apify run (serverless-safe); outside a request scope (dev/tests)
 * it falls back to an inline fire-and-forget.
 */
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";

import {
  isTikTokLiveProbeInFlight,
  isTikTokLiveProbeLaneConfigured,
  peekTikTokLiveStatus,
  probingTikTokLiveStatus,
  probeTikTokLiveStatus,
  TikTokLiveUnavailableError,
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

export async function GET(req: NextRequest): Promise<NextResponse> {
  const raw = req.nextUrl.searchParams.get("handle") ?? "";
  const handle = normalizeTikTokHandle(raw);
  if (!handle || !isTikTokHandle(handle)) {
    return NextResponse.json({ error: "Invalid TikTok handle" }, { status: 400 });
  }
  try {
    const cached = await peekTikTokLiveStatus(handle);
    if (cached) {
      return NextResponse.json({ status: cached }, { headers: { "Cache-Control": "no-store" } });
    }
  } catch (err) {
    const status = err instanceof TikTokLiveUnavailableError ? err.status : 502;
    const message =
      err instanceof Error ? err.message : "The TikTok live status is unavailable right now.";
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
  if (!isTikTokLiveProbeInFlight(handle)) {
    scheduleProbe(handle);
  }
  return NextResponse.json(
    { status: probingTikTokLiveStatus(handle) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
