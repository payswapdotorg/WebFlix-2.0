import { NextRequest, NextResponse } from "next/server";
import {
  cacheGet,
  cacheSet,
  discoverChatSession,
  pollLiveChatFrame,
  rateLimit,
  walkReplayToOffset,
  type LiveChatMode,
} from "@/lib/youtube/livechat";

/**
 * WFX2-A-S — live chat poll endpoint (serverless-friendly: ONE upstream
 * call per request; the CLIENT polls this route).
 *
 * GET /api/videos/[id]/livechat
 *   ?token=<continuation>     advance with a known token (client polling)
 *   ?mode=live|replay         which endpoint the token belongs to
 *   ?replayOffsetSec=<sec>    replay mode: seek to video offset
 *
 * No token → bootstrap: next{videoId} → conversationBar continuation, then
 * the first frame is fetched immediately. chatAvailable:false → the video
 * has no chat (panel self-hides).
 */

export const dynamic = "force-dynamic";

const SESSION_TTL_MS = 10 * 60 * 1000; // session discovery cache (10m)
const SESSION_MAX_AGE = 300;

type SessionCacheEntry = {
  chatAvailable: boolean;
  reason?: string;
  continuation?: string;
  mode?: LiveChatMode;
};

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
  if (!rateLimit(`livechat:${clientIp(req)}`)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const token = req.nextUrl.searchParams.get("token");
  const modeParam = req.nextUrl.searchParams.get("mode");
  const replayOffsetSecRaw = req.nextUrl.searchParams.get("replayOffsetSec");
  const replayOffsetSec =
    replayOffsetSecRaw !== null && /^\d+$/.test(replayOffsetSecRaw)
      ? Number(replayOffsetSecRaw)
      : null;

  // ---- advance with a known token --------------------------------------
  if (token) {
    const mode: LiveChatMode = modeParam === "replay" ? "replay" : "live";
    try {
      // replay + offset: bounded linear walk to the offset (documented
      // fallback — see livechat.ts walkReplayToOffset notes)
      if (mode === "replay" && replayOffsetSec !== null) {
        const { frame, calls, reached } = await walkReplayToOffset(
          token,
          replayOffsetSec,
        );
        return NextResponse.json(
          {
            ...frame,
            isReplay: true,
            seek: { requestedOffsetSec: replayOffsetSec, calls, reached },
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      const frame = await pollLiveChatFrame(token, mode);
      return NextResponse.json(
        { ...frame, isReplay: frame.mode === "replay" },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (err) {
      return NextResponse.json(
        {
          error: "Live chat upstream failed",
          detail: err instanceof Error ? err.message : "unknown",
        },
        { status: 502 },
      );
    }
  }

  // ---- bootstrap (no token): session discovery + first frame -------------
  const cacheKey = `livechat:session:${videoId}`;
  let session = cacheGet<SessionCacheEntry>(cacheKey);
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
      { chatAvailable: false, reason: session.reason ?? "no chat" },
      { headers: { "Cache-Control": `private, max-age=${SESSION_MAX_AGE}` } },
    );
  }

  try {
    if (session.mode === "replay" && replayOffsetSec !== null) {
      const { frame, calls, reached } = await walkReplayToOffset(
        session.continuation,
        replayOffsetSec,
      );
      return NextResponse.json(
        {
          chatAvailable: true,
          ...frame,
          isReplay: true,
          seek: { requestedOffsetSec: replayOffsetSec, calls, reached },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const frame = await pollLiveChatFrame(
      session.continuation,
      session.mode ?? "live",
    );
    return NextResponse.json(
      { chatAvailable: true, ...frame, isReplay: frame.mode === "replay" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return NextResponse.json(
      {
        chatAvailable: true,
        error: "Live chat upstream failed",
        detail: err instanceof Error ? err.message : "unknown",
      },
      { status: 502 },
    );
  }
}
