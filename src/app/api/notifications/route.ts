import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import { toChannelLite } from "@/lib/dto";
import type { NotificationDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/notifications — items (newest first) + live unread count. */
export async function GET() {
  try {
    const user = await getDemoUser();
    const rows = await db.notification.findMany({
      where: { userId: user.id },
      include: {
        sourceChannel: true,
        video: { select: { thumbnailUrl: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    const items: NotificationDTO[] = rows.map((n) => ({
      id: n.id,
      kind: n.kind as NotificationDTO["kind"],
      title: n.title,
      body: n.body,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
      videoId: n.videoId,
      videoThumbnailUrl: n.video?.thumbnailUrl ?? null,
      channel: toChannelLite(n.sourceChannel),
    }));
    return NextResponse.json({ unread: items.filter((i) => !i.read).length, items });
  } catch (err) {
    console.error("GET /api/notifications failed", err);
    return NextResponse.json({ error: "Failed to load notifications" }, { status: 500 });
  }
}
