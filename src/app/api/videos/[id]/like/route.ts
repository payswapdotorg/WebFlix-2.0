import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  value: z.enum(["like", "dislike"]).nullable(),
});

/** POST /api/videos/[id]/like { value: "like"|"dislike"|null } — toggle rating. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'value must be "like", "dislike" or null' }, { status: 400 });
    }
    const video = await db.video.findUnique({ where: { id } });
    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }
    const user = await getDemoUser();
    const value = parsed.data.value;

    const existing = await db.videoLike.findUnique({
      where: { userId_videoId: { userId: user.id, videoId: id } },
    });

    // Compute the delta and write video + rating atomically-ish.
    let likes = video.likes;
    let dislikes = video.dislikes;
    if (existing?.value === "like") likes--;
    if (existing?.value === "dislike") dislikes--;
    if (value === "like") likes++;
    if (value === "dislike") dislikes++;

    if (existing) {
      if (value === null) {
        await db.videoLike.delete({ where: { userId_videoId: { userId: user.id, videoId: id } } });
      } else {
        await db.videoLike.update({
          where: { userId_videoId: { userId: user.id, videoId: id } },
          data: { value },
        });
      }
    } else if (value) {
      await db.videoLike.create({ data: { userId: user.id, videoId: id, value } });
    }

    const updated = await db.video.update({
      where: { id },
      data: { likes: Math.max(0, likes), dislikes: Math.max(0, dislikes) },
    });

    return NextResponse.json({
      likes: updated.likes,
      dislikes: updated.dislikes,
      yourRating: value,
    });
  } catch (err) {
    console.error("POST /api/videos/[id]/like failed", err);
    return NextResponse.json({ error: "Failed to rate video" }, { status: 500 });
  }
}
