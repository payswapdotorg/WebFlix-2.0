import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import { toVideoDTO } from "@/lib/dto";
import type { StudioDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/studio — the demo user's channel (CodeCraft) + real stats. */
export async function GET() {
  try {
    const user = await getDemoUser();
    const channel = await db.channel.findFirst({
      where: { ownerId: user.id },
    });
    if (!channel) {
      return NextResponse.json({ error: "You don't own a channel yet" }, { status: 404 });
    }
    const videos = await db.video.findMany({
      where: { channelId: channel.id },
      include: { channel: true },
      orderBy: { createdAt: "desc" },
    });
    const commentCounts = new Map<string, number>();
    for (const v of videos) {
      const c = await db.comment.count({ where: { videoId: v.id } });
      commentCounts.set(v.id, c);
    }
    const totals = {
      views: videos.reduce((sum, v) => sum + v.views, 0),
      likes: videos.reduce((sum, v) => sum + v.likes, 0),
      videos: videos.length,
      comments: [...commentCounts.values()].reduce((a, b) => a + b, 0),
    };
    const data: StudioDTO = {
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
      },
      totals,
      videos: videos.map((v) => ({ ...toVideoDTO(v), commentCount: commentCounts.get(v.id) ?? 0 })),
    };
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/studio failed", err);
    return NextResponse.json({ error: "Failed to load studio" }, { status: 500 });
  }
}
