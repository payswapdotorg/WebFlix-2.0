import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveViewer } from "@/lib/watch/session";
import { listPlaylists, createPlaylist } from "@/lib/watch/playlist-service";
import { toVideoDTO } from "@/lib/dto";
import type { PlaylistDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Boot-lane page shape: the full playlists tree with videos, ordered. */
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

/**
 * GET /api/playlists — two shapes, one route:
 *  - no query: the playlists page's bare array (boot lane)
 *  - ?videoId=: the Save dialog's { playlists } with containsVideo flags (watch lane)
 */
export async function GET(req: NextRequest) {
  try {
    const viewer = await resolveViewer(req.headers);
    const videoId = new URL(req.url).searchParams.get("videoId");
    if (videoId) {
      const playlists = await listPlaylists(videoId, viewer.id);
      return NextResponse.json({ playlists });
    }
    return NextResponse.json(await loadPlaylists(viewer.id));
  } catch (err) {
    console.error("GET /api/playlists failed", err);
    return NextResponse.json({ error: "Failed to load playlists" }, { status: 500 });
  }
}

/**
 * POST /api/playlists { name, visibility } — create from the Save dialog
 * (watch-lane service: reserved-name + duplicate validation). The playlists
 * page uses the same endpoint and reloads its list after.
 */
export async function POST(req: NextRequest) {
  try {
    const viewer = await resolveViewer(req.headers);
    const body = (await req.json()) as { name?: string; title?: string; visibility?: string };
    const name = (body.name ?? body.title ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "Playlist name cannot be empty" }, { status: 400 });
    }
    const playlist = await createPlaylist(viewer.id, name, body.visibility ?? "private");
    return NextResponse.json({ playlist }, { status: 201 });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : "Failed to create playlist";
    console.error("POST /api/playlists failed", err);
    return NextResponse.json({ error: message }, { status });
  }
}
