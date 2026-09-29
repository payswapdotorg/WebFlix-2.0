import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import { toChannelLite, toVideoDTO } from "@/lib/dto";
import type { SubscriptionsPageDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/subscriptions — subscribed channels + their latest videos. */
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
