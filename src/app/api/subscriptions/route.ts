import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import { toChannelLite, toVideoDTO } from "@/lib/dto";
import { errorResponse, json } from "@/lib/watch/api";
import { proxySubscriptionStateMachine } from "@/lib/watch/action-proxy";
import type { SubscriptionsPageDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/subscriptions — subscribed channels + their latest videos (read
 * lane swaps this to live SSR data; unchanged here). */
export async function GET() {
  try {
    const user = await getDemoUser();
    const subs = await db.subscribe.findMany({
      where: { userId: user.id },
      include: { channel: true },
      orderBy: { createdAt: "asc" },
    });
    const channelIds = subs.map((s) => s.channelId);
    const videos = await db.video.findMany({
      where: { channelId: { in: channelIds }, visibility: "public" },
      include: { channel: true },
      orderBy: { createdAt: "desc" },
      take: 24,
    });
    const data: SubscriptionsPageDTO = {
      channels: subs.map((s) => toChannelLite(s.channel)),
      videos: videos.map(toVideoDTO),
    };
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/subscriptions failed", err);
    return NextResponse.json({ error: "Failed to load subscriptions" }, { status: 500 });
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
