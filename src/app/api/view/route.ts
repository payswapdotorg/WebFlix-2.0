import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/view { videoId, watchedSec } — records watch progress.
 * One ViewEvent per viewing session: if the latest event for this
 * (user, video) is under 6h old it is updated (max progress, fresh `at`),
 * otherwise a new event row is created (history + analytics).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { videoId?: string; watchedSec?: number };
    const videoId = body.videoId;
    const watchedSec = Math.max(0, Math.floor(body.watchedSec ?? 0));
    if (!videoId) {
      return NextResponse.json({ error: "videoId is required" }, { status: 400 });
    }
    const user = await getDemoUser();
    const video = await db.video.findUnique({ where: { id: videoId } });
    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }

    const latest = await db.viewEvent.findFirst({
      where: { userId: user.id, videoId },
      orderBy: { at: "desc" },
    });
    const sixHours = 6 * 3_600_000;
    if (latest && Date.now() - latest.at.getTime() < sixHours) {
      await db.viewEvent.update({
        where: { id: latest.id },
        data: { watchedSec: Math.max(latest.watchedSec, watchedSec), at: new Date() },
      });
    } else {
      await db.viewEvent.create({
        data: { userId: user.id, videoId, watchedSec, at: new Date() },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/view failed", err);
    return NextResponse.json({ error: "Failed to record view" }, { status: 500 });
  }
}
