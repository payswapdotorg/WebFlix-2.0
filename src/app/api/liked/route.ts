import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import { toVideoDTO } from "@/lib/dto";
import type { VideoDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/liked — videos the demo user liked (newest like first). */
export async function GET() {
  try {
    const user = await getDemoUser();
    const likes = await db.videoLike.findMany({
      where: { userId: user.id, value: "like" },
      include: { video: { include: { channel: true } } },
      orderBy: { createdAt: "desc" },
    });
    const videos: VideoDTO[] = likes.map((l) => toVideoDTO(l.video));
    return NextResponse.json(videos);
  } catch (err) {
    console.error("GET /api/liked failed", err);
    return NextResponse.json({ error: "Failed to load liked videos" }, { status: 500 });
  }
}
