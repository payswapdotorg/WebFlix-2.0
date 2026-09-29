import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import { toChannelLite, toVideoDTO } from "@/lib/dto";
import { setSubscription } from "@/lib/watch/subscription-service";
import { subscriptionBodySchema } from "@/lib/watch/validators";
import { resolveViewer } from "@/lib/watch/session";
import type { SubscriptionsPageDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/subscriptions — subscribed channels + their latest videos (boot lane). */
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
 * POST /api/subscriptions {channelId, bell} — the subscribe state machine
 * (watch lane). bell: "all" | "personalized" | "none" subscribes (or updates);
 * bell "off" (or omitted) unsubscribes. Counts stay honest (transactional).
 */
export async function POST(req: NextRequest) {
  try {
    const viewer = await resolveViewer(req.headers);
    const body = subscriptionBodySchema.parse(await req.json());
    const result = await setSubscription(body.channelId, viewer.id, body.bell);
    return NextResponse.json(result);
  } catch (err) {
    console.error("POST /api/subscriptions failed", err);
    return NextResponse.json({ error: "Failed to update subscription" }, { status: 500 });
  }
}
