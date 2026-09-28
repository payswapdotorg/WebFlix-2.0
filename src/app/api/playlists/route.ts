import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import { toVideoDTO } from "@/lib/dto";
import { z } from "zod";
import type { PlaylistDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

async function loadPlaylists(userId: string): Promise<PlaylistDTO[]> {
  const playlists = await db.playlist.findMany({
    where: { userId },
    orderBy: [{ isWatchLater: "desc" }, { createdAt: "desc" }],
    include: {
      items: { include: { video: { include: { channel: true } } }, orderBy: { position: "asc" } },
    },
  });
  return playlists.map((p) => ({
    id: p.id,
    title: p.title,
    visibility: p.visibility as PlaylistDTO["visibility"],
    isWatchLater: p.isWatchLater,
    createdAt: p.createdAt.toISOString(),
    videoCount: p.items.length,
    coverUrl: p.items[0]?.video.thumbnailUrl ?? null,
    videos: p.items.map((i) => toVideoDTO(i.video)),
  }));
}

export async function GET() {
  try {
    const user = await getDemoUser();
    return NextResponse.json(await loadPlaylists(user.id));
  } catch (err) {
    console.error("GET /api/playlists failed", err);
    return NextResponse.json({ error: "Failed to load playlists" }, { status: 500 });
  }
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(100),
  visibility: z.enum(["public", "unlisted", "private"]).default("private"),
});

/** POST /api/playlists { title, visibility } — create a new playlist. */
export async function POST(req: Request) {
  try {
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
    }
    const user = await getDemoUser();
    await db.playlist.create({
      data: { userId: user.id, title: parsed.data.title, visibility: parsed.data.visibility },
    });
    return NextResponse.json(await loadPlaylists(user.id), { status: 201 });
  } catch (err) {
    console.error("POST /api/playlists failed", err);
    return NextResponse.json({ error: "Failed to create playlist" }, { status: 500 });
  }
}
