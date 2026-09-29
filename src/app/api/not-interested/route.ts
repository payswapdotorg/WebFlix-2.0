import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({ videoId: z.string().min(1) });

/** POST /api/not-interested { videoId } — hides from recommendations. */
export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "videoId is required" }, { status: 400 });
    }
    const user = await getDemoUser();
    const { videoId } = parsed.data;
    const video = await db.video.findUnique({ where: { id: videoId } });
    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }
    await db.videoSignal.upsert({
      where: { videoId_userId: { videoId, userId: user.id } },
      update: { kind: "not_interested" },
      create: { videoId, userId: user.id, kind: "not_interested" },
    });
    return NextResponse.json({ hidden: true });
  } catch (err) {
    console.error("POST /api/not-interested failed", err);
    return NextResponse.json({ error: "Failed to hide video" }, { status: 500 });
  }
}
