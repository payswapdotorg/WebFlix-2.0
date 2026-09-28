import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  playlistId: z.string().min(1),
  videoId: z.string().min(1),
});

/** POST /api/playlists/items { playlistId, videoId } — add a video to a playlist. */
export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "playlistId and videoId are required" }, { status: 400 });
    }
    const user = await getDemoUser();
    const { playlistId, videoId } = parsed.data;
    const playlist = await db.playlist.findFirst({
      where: { id: playlistId, userId: user.id },
    });
    if (!playlist) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }
    const video = await db.video.findUnique({ where: { id: videoId } });
    if (!video) {
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }
    const existing = await db.playlistItem.findUnique({
      where: { playlistId_videoId: { playlistId, videoId } },
    });
    if (existing) {
      return NextResponse.json({ added: false, reason: "already-saved" });
    }
    const count = await db.playlistItem.count({ where: { playlistId } });
    await db.playlistItem.create({
      data: { playlistId, videoId, position: count },
    });
    return NextResponse.json({ added: true });
  } catch (err) {
    console.error("POST /api/playlists/items failed", err);
    return NextResponse.json({ error: "Failed to save to playlist" }, { status: 500 });
  }
}
