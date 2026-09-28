/**
 * WFX2-W playlist service — the Save dialog backend (Watch later +
 * playlists list + create-new). WFX2-A (account lane) will extend with full
 * CRUD; this lane owns the watch-page surface.
 */
import { db } from "@/lib/db";
import { notFound, forbidden, badRequest } from "./api";
import type { PlaylistDto } from "./types";

export async function listPlaylists(videoId: string, userId: string): Promise<PlaylistDto[]> {
  const playlists = await db.playlist.findMany({
    where: { userId },
    include: { _count: { select: { items: true } } },
    orderBy: [{ isWatchLater: "desc" }, { createdAt: "asc" }],
  });
  const containing = await db.playlistItem.findMany({
    where: { videoId, playlist: { userId } },
    select: { playlistId: true },
  });
  const contains = new Set(containing.map((c) => c.playlistId));
  return playlists.map((p) => ({
    id: p.id,
    name: p.name,
    isWatchLater: p.isWatchLater,
    visibility: p.visibility,
    itemCount: p._count.items,
    containsVideo: contains.has(p.id),
  }));
}

export async function createPlaylist(
  userId: string,
  name: string,
  visibility: string
): Promise<PlaylistDto> {
  const clean = name.trim();
  if (!clean) throw badRequest("Playlist name cannot be empty");
  if (clean.toLowerCase() === "watch later") throw badRequest("Watch later is a reserved playlist");
  const existing = await db.playlist.findFirst({ where: { userId, name: clean } });
  if (existing) throw badRequest(`You already have a playlist named "${clean}"`);
  const created = await db.playlist.create({ data: { userId, name: clean, visibility } });
  return {
    id: created.id,
    name: created.name,
    isWatchLater: false,
    visibility: created.visibility,
    itemCount: 0,
    containsVideo: false,
  };
}

/** Add/remove a video to one of the viewer's playlists. */
export async function togglePlaylistItem(
  playlistId: string,
  videoId: string,
  userId: string
): Promise<{ containsVideo: boolean }> {
  const playlist = await db.playlist.findUnique({ where: { id: playlistId } });
  if (!playlist) throw notFound("Playlist");
  if (playlist.userId !== userId) throw forbidden("Not your playlist");
  const video = await db.video.findUnique({ where: { id: videoId }, select: { id: true } });
  if (!video) throw notFound("Video");

  const existing = await db.playlistItem.findUnique({
    where: { playlistId_videoId: { playlistId, videoId } },
  });
  if (existing) {
    await db.playlistItem.delete({ where: { id: existing.id } });
    return { containsVideo: false };
  }
  await db.playlistItem.create({ data: { playlistId, videoId } });
  return { containsVideo: true };
}
