import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import { toVideoDTO } from "@/lib/dto";
import type { ChannelPageDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/channel/[handle] — banner, tabs data (videos / shorts / about). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ handle: string }> }
) {
  try {
    const { handle } = await params;
    const channel = await db.channel.findUnique({ where: { handle } });
    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }
    const user = await getDemoUser().catch(() => null);
    const sub = user
      ? await db.subscribe.findUnique({
          where: { userId_channelId: { userId: user.id, channelId: channel.id } },
        })
      : null;
    const videos = await db.video.findMany({
      where: { channelId: channel.id, visibility: "public", isShort: false },
      include: { channel: true },
      orderBy: { createdAt: "desc" },
    });
    const shorts = await db.video.findMany({
      where: { channelId: channel.id, visibility: "public", isShort: true },
      include: { channel: true },
      orderBy: { views: "desc" },
    });
    const data: ChannelPageDTO = {
      channel: {
        id: channel.id,
        handle: channel.handle,
        name: channel.name,
        avatarUrl: channel.avatarUrl,
        verified: channel.verified,
        subscriberCount: channel.subscriberCount,
        bannerUrl: channel.bannerUrl,
        description: channel.description,
        createdAt: channel.createdAt.toISOString(),
        isSubscribed: !!sub,
        isOwner: channel.ownerId === user?.id,
        videoCount: videos.length,
      },
      videos: videos.map(toVideoDTO),
      shorts: shorts.map(toVideoDTO),
    };
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/channel/[handle] failed", err);
    return NextResponse.json({ error: "Failed to load channel" }, { status: 500 });
  }
}
