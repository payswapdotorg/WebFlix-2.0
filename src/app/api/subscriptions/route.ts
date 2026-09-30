import { NextRequest, NextResponse } from "next/server";
import { getSubscriptionsFeed } from "@/lib/youtube/subscriptions";
import { hasSession } from "@/lib/youtube/session";
import { rateLimit } from "@/lib/youtube/cache";
import { errorResponse, json } from "@/lib/watch/api";
import { proxySubscriptionStateMachine } from "@/lib/watch/action-proxy";

export const dynamic = "force-dynamic";

/**
 * GET /api/subscriptions?cursor= — the operator's REAL subscriptions feed
 * (SSR /feed/subscriptions — the 95-item real capture is the fixture; browse
 * continuations page it). The channel rail lists the feed's own distinct
 * channels (subscribed channels with recent uploads). Public mode (no
 * YT_COOKIES): the SSR page answers the "Don't miss new videos" sign-in
 * promo → { channels: [], videos: [], loginRequired: true } — honest.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await rateLimit(`subscriptions:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;
    const feed = await getSubscriptionsFeed(cursor || undefined);
    return NextResponse.json({
      channels: feed.channels,
      videos: feed.videos,
      nextCursor: feed.nextCursor,
      loginRequired: feed.loginRequired,
      session: hasSession(),
    });
  } catch (err) {
    console.error("GET /api/subscriptions failed", err);
    return NextResponse.json({ error: "Failed to load subscriptions" }, { status: 502 });
  }
}

/**
 * POST /api/subscriptions { channelId, bell, subscriberCount? } — LIVE
 * Tier-2 write (the watch page subscribe state machine).
 *
 * bell "off" (or omitted) → unsubscribe (direct-first, broker fallback);
 * bell all|personalized|none → subscribe (direct-first) + bell pref
 * (broker). Response keeps the SubscriptionResultDto shape; subscriberCount
 * is the UI's baseline ± 1, or -1 when unknown (the UI then leaves the
 * displayed count alone). Plus ok/effect/path.
 */
export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return json({ error: "body must be JSON" }, 400);
    }
    const channelId = typeof body.channelId === "string" ? body.channelId : "";
    if (!channelId) return json({ error: "channelId is required" }, 400);
    const bellRaw = typeof body.bell === "string" ? body.bell : undefined;
    if (bellRaw && !["all", "personalized", "none", "off"].includes(bellRaw)) {
      return json({ error: "bell must be all|personalized|none|off" }, 400);
    }
    const countBaseline =
      typeof body.subscriberCount === "number" && Number.isFinite(body.subscriberCount)
        ? body.subscriberCount
        : null;
    const result = await proxySubscriptionStateMachine(
      channelId,
      bellRaw as "all" | "personalized" | "none" | "off" | undefined,
      countBaseline
    );
    return json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
