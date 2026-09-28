import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  videoId: z.string().min(1),
  add: z.boolean().optional(), // default: toggle
});

/** POST /api/playlists/watch-later { videoId, add? } — toggle Watch later. */
export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "videoId is required" }, { status: 400 });
    }
    const user = await getDemoUser();
    const { videoId, add } = parsed.data;

    let playlist = await db.playlist.findFirst({
      where: { userId: user.id, isWatchLater: true },
    });
    if (!playlist) {
      playlist = await db.playlist.create({
        data: { userId: user.id, title: "Watch Later", isWatchLater: true, visibility: "private" },
      });
    }

    const existing = await db.playlistItem.findUnique({
      where: { playlistId_videoId: { playlistId: playlist.id, videoId } },
    });
    const shouldAdd = add ?? !existing;

    if (shouldAdd && !existing) {
      const count = await db.playlistItem.count({ where: { playlistId: playlist.id } });
      await db.playlistItem.create({
        data: { playlistId: playlist.id, videoId, position: count },
      });
    } else if (!shouldAdd && existing) {
      await db.playlistItem.delete({
        where: { playlistId_videoId: { playlistId: playlist.id, videoId } },
      });
    }
    return NextResponse.json({ added: shouldAdd, playlistId: playlist.id });
  } catch (err) {
    console.error("POST /api/playlists/watch-later failed", err);
    return NextResponse.json({ error: "Failed to update Watch later" }, { status: 500 });
  }
}
