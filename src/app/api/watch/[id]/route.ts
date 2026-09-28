import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import { toVideoDTO } from "@/lib/dto";
import type { CommentDTO, WatchPageDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/watch/[id] — video + engagement state + related + comments (top-level). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const video = await db.video.findUnique({
      where: { id },
      include: { channel: true },
    });
    if (!video || video.visibility === "private") {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }
    const user = await getDemoUser().catch(() => null);

    const sub = user
      ? await db.subscribe.findUnique({
          where: { userId_channelId: { userId: user.id, channelId: video.channelId } },
        })
      : null;

    const membership = user
      ? await db.membership.findFirst({
          where: { userId: user.id, tier: { channelId: video.channelId } },
          include: { tier: true },
        })
      : null;

    // Related: same category first (views desc), then the rest.
    const sameCategory = await db.video.findMany({
      where: { visibility: "public", id: { not: video.id }, category: video.category },
      include: { channel: true },
      orderBy: { views: "desc" },
      take: 6,
    });
    const other = await db.video.findMany({
      where: { visibility: "public", id: { not: video.id }, category: { not: video.category } },
      include: { channel: true },
      orderBy: { views: "desc" },
      take: 12,
    });
    const related = [...sameCategory, ...other].slice(0, 12).map(toVideoDTO);

    const commentRows = await db.comment.findMany({
      where: { videoId: video.id, moderation: "approved", parentId: null },
      include: { user: true, replies: { select: { id: true } } },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
      take: 12,
    });
    const comments: CommentDTO[] = commentRows.map((c) => ({
      id: c.id,
      body: c.body,
      likes: c.likes,
      heartedByCreator: c.heartedByCreator,
      pinned: c.pinned,
      createdAt: c.createdAt.toISOString(),
      author: { handle: c.user.handle, name: c.user.name, avatarUrl: c.user.avatarUrl },
      replyCount: c.replies.length,
    }));

    const data: WatchPageDTO = {
      video: toVideoDTO(video),
      isSubscribed: !!sub,
      isOwner: video.channel.ownerId === user?.id,
      memberTierName: membership?.tier.name ?? null,
      related,
      comments,
    };
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/watch/[id] failed", err);
    return NextResponse.json({ error: "Failed to load video" }, { status: 500 });
  }
}
