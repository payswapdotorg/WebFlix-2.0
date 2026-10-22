import { NextResponse } from "next/server";
import { getPublicPlaylist } from "@/lib/youtube/playlist";
import { isSpecialPlaylistId } from "@/lib/youtube/playlists";
import { rateLimit } from "@/lib/youtube/cache";
import { getSessionUser } from "@/lib/auth/session";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";
import type { PlaylistPageDTO, VideoDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The honest notice envelope (playlist: null — the page renders its notice). */
function specialNotice(notice: string) {
  return NextResponse.json({
    playlist: null,
    videos: [],
    nextCursor: null,
    loginRequired: false,
    unavailable: false,
    special: true,
    notice,
  });
}

/**
 * GET /api/playlist/[id]?cursor= — the public playlist page data
 * (WFX2-B-W): browse {browseId: "VL<playlistId>"} → header (title, owner,
 * stats) + the video grid (lockupViewModels). Playlist-result cards from
 * search link here.
 *
 * WFX2-P36: the PUBLIC PL… reads stay exactly as they are (public content,
 * no identity involved). LL (Liked) answers the honest per-user notice
 * envelope — the pre-P36 branch read the OPERATOR's Liked list through the
 * session seam and served it to every signed-in user (the exact cross-user
 * leak the P36 work order closes), and the list has no official per-user
 * read API.
 *
 * WFX2-P37 — WL (Watch later) now serves the WEBFLIX-LOCAL list: the acting
 * user's own rows from the same local store the save button writes (the
 * one Watch-later lane that works without a YouTube connection). The
 * pre-P37 shape — an explainer-only notice for EVERY user — hid the user's
 * own saved videos behind copy about what WebFlix cannot do: a real
 * discoverability failure measured 2026-10-22 (saved items persisted
 * server-side but NO surface ever showed them). The payload keeps the
 * page's existing PlaylistPageDTO contract (the two-column layout renders
 * it unchanged) + `local: true` for the honest disclosure note. Guests and
 * store failures keep the honest notice envelope.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await rateLimit(`playlist:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const { id } = await params;
    if (isSpecialPlaylistId(id)) {
      if (id === "WL") {
        const sessionUser = await getSessionUser(req);
        if (!sessionUser) {
          return specialNotice(
            "Sign in to see your WebFlix Watch later — the list lives on your account",
          );
        }
        try {
          const user = await ensureShadowUser(sessionUser);
          const wl = await db.playlist.findFirst({
            where: { userId: user.id, isWatchLater: true },
            select: { id: true },
          });
          const items = wl
            ? await db.playlistItem.findMany({
                where: { playlistId: wl.id },
                orderBy: { position: "asc" },
                include: { video: { include: { channel: true } } },
              })
            : [];
          const videos: VideoDTO[] = items.map((item) => shadowVideoToDto(item.video));
          const page: PlaylistPageDTO = {
            playlist: {
              id: "WL",
              title: "Watch later",
              channelName: user.name || "You",
              videoCountText: `${videos.length} video${videos.length === 1 ? "" : "s"}`,
              viewsText: null,
              description: null,
            },
            videos,
            nextCursor: null,
            special: true,
          };
          return NextResponse.json({ ...page, local: true });
        } catch {
          return specialNotice(
            "Your Watch later could not be read just now — try again shortly",
          );
        }
      }
      // LL — the honest per-user notice (no official API, no local liked store)
      return specialNotice(
        "YouTube's Liked list has no official API — YouTube's own page has it; WebFlix never reads someone else's",
      );
    }
    const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;
    const page = await getPublicPlaylist(id, cursor);
    if (!page) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }
    return NextResponse.json(page);
  } catch (err) {
    console.error("GET /api/playlist/[id] failed", err);
    return NextResponse.json({ error: "Failed to load playlist" }, { status: 502 });
  }
}

/** The shadow video row → the page's VideoDTO (honest defaults for the
 * fields the local mirror never captures — never fabricated values). */
function shadowVideoToDto(video: {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  videoUrl: string;
  durationSec: number;
  views: number;
  likes: number;
  dislikes: number;
  visibility: string;
  isMembersOnly: boolean;
  membersTier: string | null;
  category: string;
  isShort: boolean;
  isLive: boolean;
  premieredAt: Date | null;
  createdAt: Date;
  channel: {
    id: string;
    handle: string;
    name: string;
    avatarUrl: string;
    verified: boolean;
    subscriberCount: number;
  };
}): VideoDTO {
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    thumbnailUrl: video.thumbnailUrl,
    videoUrl: video.videoUrl,
    durationSec: video.durationSec > 0 ? video.durationSec : null,
    views: video.views,
    viewsText: null,
    likes: video.likes,
    dislikes: video.dislikes,
    visibility:
      video.visibility === "unlisted" || video.visibility === "private"
        ? (video.visibility as "public" | "unlisted" | "private")
        : "public",
    isMembersOnly: video.isMembersOnly,
    membersTier: video.membersTier,
    category: video.category,
    isShort: video.isShort,
    isLive: video.isLive,
    premieredAt: video.premieredAt ? video.premieredAt.toISOString() : null,
    createdAt: video.createdAt ? video.createdAt.toISOString() : null,
    channel: {
      id: video.channel.id,
      handle: video.channel.handle,
      name: video.channel.name,
      avatarUrl: video.channel.avatarUrl,
      verified: video.channel.verified,
      subscriberCount: video.channel.subscriberCount,
    },
  };
}
