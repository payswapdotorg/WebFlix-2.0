import { NextRequest, NextResponse } from "next/server";
import { getHistoryFeed } from "@/lib/youtube/history";
import { hasSession } from "@/lib/youtube/session";
import { rateLimit } from "@/lib/youtube/cache";
import { brokerAction, brokerOk, BrokerError } from "@/lib/broker";

export const dynamic = "force-dynamic";

/**
 * GET /api/history?cursor= — the operator's REAL YouTube watch history
 * (SSR /feed/history + browse continuations), grouped by the page's own day
 * headers. Public mode (no YT_COOKIES): the SSR page answers the sign-in
 * promo → { groups: [], loginRequired: true } — honest, never fake rows.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await rateLimit(`history:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;
    const feed = await getHistoryFeed(cursor || undefined);
    return NextResponse.json({
      groups: feed.groups,
      nextCursor: feed.nextCursor,
      loginRequired: feed.loginRequired,
      watchHistoryPaused: feed.watchHistoryPaused,
      searchHistoryPaused: feed.searchHistoryPaused,
      total: feed.total,
      session: hasSession(),
    });
  } catch (err) {
    console.error("GET /api/history failed", err);
    return NextResponse.json({ error: "Failed to load history" }, { status: 502 });
  }
}

/** Map a broker failure to the honest HTTP response. */
function brokerErrorResponse(err: BrokerError): NextResponse {
  if (err.kind === "bad-request") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  return NextResponse.json({ error: err.message }, { status: 502 });
}

/**
 * DELETE /api/history?videoId= — remove ONE video from the real watch
 * history (broker kind `history-remove`, Tier-2). Without a videoId: clear
 * ALL watch history (broker kind `history-clear-all`).
 */
export async function DELETE(req: NextRequest) {
  try {
    const videoId = new URL(req.url).searchParams.get("videoId") ?? "";
    if (videoId && !/^[\w-]{6,20}$/.test(videoId)) {
      return NextResponse.json({ error: "videoId is invalid" }, { status: 400 });
    }
    const result = videoId
      ? await brokerAction("history-remove", { videoId })
      : await brokerAction("history-clear-all", {});
    if (!brokerOk(result)) return brokerErrorResponse(result as BrokerError);
    const r = result as { ok: true; verified?: boolean; already?: boolean; path?: string };
    return NextResponse.json({
      ok: true,
      effect: videoId ? "removed-from-history" : "history-cleared",
      verified: r.verified ?? false,
      path: r.path ?? null,
    });
  } catch (err) {
    console.error("DELETE /api/history failed", err);
    return NextResponse.json({ error: "Failed to update history" }, { status: 500 });
  }
}

/**
 * PATCH /api/history {paused: boolean, type?: "watch"|"search"} — the
 * pause/resume toggles on the real account (broker kinds `history-pause` /
 * `search-history-pause`, Tier-2).
 */
export async function PATCH(req: NextRequest) {
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
    }
    const paused = body.paused === true;
    const type = body.type === "search" ? "search" : "watch";
    const result =
      type === "search"
        ? await brokerAction("search-history-pause", {}, { paused })
        : await brokerAction("history-pause", {}, { paused });
    if (!brokerOk(result)) return brokerErrorResponse(result as BrokerError);
    const r = result as { ok: true; verified?: boolean; already?: boolean; path?: string };
    return NextResponse.json({
      ok: true,
      type,
      paused,
      effect: paused ? "paused" : "resumed",
      verified: r.verified ?? false,
      already: r.already ?? false,
      path: r.path ?? null,
    });
  } catch (err) {
    console.error("PATCH /api/history failed", err);
    return NextResponse.json({ error: "Failed to toggle history" }, { status: 500 });
  }
}
