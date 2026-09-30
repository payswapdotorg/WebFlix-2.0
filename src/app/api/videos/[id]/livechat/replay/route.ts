import { NextRequest, NextResponse } from "next/server";
import {
  callLiveChatReplay,
  cacheGet,
  cacheSet,
  discoverChatSession,
  parseLiveChatFrame,
  rateLimit,
  walkReplayToEdge,
  walkReplayToOffset,
} from "@/lib/youtube/livechat";

/**
 * WFX2-A-S — live chat REPLAY endpoint (ended live streams).
 *
 * GET /api/videos/[id]/livechat/replay
 *   ?token=<continuation>  resume walking from a token (default: bootstrap
 *                          via next() when absent)
 *   ?offsetSec=<sec>       seek to a video time offset (two known modes
 *                          below; offset = bounded linear walk)
 *   ?mode=full|offset|live-edge
 *
 * Modes (documented honestly — see evidence/wfx2as/LIVESHORTS.md):
 * - full (default, no offsetSec): replay from the START; returns the first
 *   frame + nextToken for forward walking.
 * - offset (offsetSec given): server-side bounded linear continuation walk
 *   until videoOffsetTimeMsec >= offsetSec*1000. The byte-level base64-proto
 *   seek params are NOT derivable from public shapes (probed: the request
 *   `params` field is ignored by the endpoint; patched continuation tokens
 *   400) — the linear walk is the verified fallback.
 * - live-edge: walk to the END of the replay, return the tail frame.
 */

export const dynamic = "force-dynamic";

const SESSION_TTL_MS = 10 * 60 * 1000;

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local"
  );
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: videoId } = await ctx.params;
  if (!(await rateLimit(`livechat-replay:${clientIp(req)}`, 20, 0.3))) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const token = req.nextUrl.searchParams.get("token");
  const offsetSecRaw = req.nextUrl.searchParams.get("offsetSec");
  const mode = req.nextUrl.searchParams.get("mode");
  const offsetSec =
    offsetSecRaw !== null && /^\d+$/.test(offsetSecRaw)
      ? Number(offsetSecRaw)
      : null;

  // Resolve the start token (bootstrap via next() when absent).
  let startToken = token;
  if (!startToken) {
    const cacheKey = `livechat:session:${videoId}`;
    type Entry = {
      chatAvailable: boolean;
      reason?: string;
      continuation?: string;
      mode?: string;
    };
    let session = cacheGet<Entry>(cacheKey);
    if (!session) {
      const discovered = await discoverChatSession(videoId);
      session = discovered.chatAvailable
        ? {
            chatAvailable: true,
            continuation: discovered.continuation,
            mode: discovered.mode,
          }
        : { chatAvailable: false, reason: discovered.reason };
      cacheSet(cacheKey, session, SESSION_TTL_MS);
    }
    if (!session.chatAvailable || !session.continuation) {
      return NextResponse.json(
        {
          chatAvailable: false,
          reason: session.reason ?? "no conversationBar — no chat replay",
        },
        { status: 404 },
      );
    }
    if (session.mode === "live") {
      return NextResponse.json(
        {
          chatAvailable: false,
          reason: "video is currently LIVE — use /livechat (live mode)",
        },
        { status: 409 },
      );
    }
    startToken = session.continuation;
  }

  try {
    // live-edge mode: walk to the end of the replay.
    if (mode === "live-edge") {
      const { frame, calls } = await walkReplayToEdge(startToken);
      return NextResponse.json(
        {
          chatAvailable: true,
          ...frame,
          isReplay: true,
          seek: { mode: "live-edge", calls, reached: true },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // offset mode: bounded linear walk to the requested video time.
    if (offsetSec !== null) {
      const { frame, calls, reached } = await walkReplayToOffset(
        startToken,
        offsetSec,
      );
      return NextResponse.json(
        {
          chatAvailable: true,
          ...frame,
          isReplay: true,
          seek: {
            mode: "offset",
            requestedOffsetSec: offsetSec,
            calls,
            reached,
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // full mode: first frame from the start token.
    const frame = parseLiveChatFrame(
      await callLiveChatReplay(startToken),
      "replay",
    );
    return NextResponse.json(
      { chatAvailable: true, ...frame, isReplay: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "Live chat replay upstream failed",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 502 },
    );
  }
}
