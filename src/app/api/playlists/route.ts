import { NextRequest, NextResponse } from "next/server";
import { hasSession } from "@/lib/youtube/session";
import { rateLimit } from "@/lib/youtube/cache";
import { errorResponse } from "@/lib/watch/api";
import {
  proxyPlaylistCreate,
  readLocalSavedWatchLater,
  resolveActionTier,
  resolveReadTier,
  tierError,
} from "@/lib/watch/action-proxy";
import {
  officialListPlaylists,
  officialPlaylistMembership,
} from "@/lib/youtube/official-actions";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { db } from "@/lib/db";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import type { WebFlixSessionUser } from "@/lib/auth/types";
import type { PlaylistDTO } from "@/lib/types";
import type { PlaylistDto } from "@/lib/watch/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/playlists — WFX2-P36: the SIGNED-IN user's own playlists, read
 * through the official YouTube Data API with their connected account. The
 * pre-P36 operator read (the deployment-wide SSR /feed/playlists — one
 * person's real playlists served to every user) is RETIRED with the rest of
 * the shared-identity paths: an unconnected or failed official read answers
 * the honest empty + notice, NEVER the operator's data.
 *
 * Two shapes, one route:
 *  - no query — the playlists PAGE: { playlists, loginRequired, unavailable,
 *    session, connected, notice } (the page's existing top-level keys kept,
 *    connected/notice additive for the honest per-user banner).
 *  - ?videoId= — the watch-page Save dialog: { playlists, connected, notice? }
 *    with the local Watch-later row FIRST (local:true — the WebFlix list;
 *    YouTube's own WL is a system playlist the Data API cannot write) and the
 *    user's real playlists after it, each with its containsVideo membership
 *    flag read through their own token.
 */
export async function GET(req: NextRequest) {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return authRequiredResponse();
  try {
    if (!(await rateLimit(`playlists:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const videoId = new URL(req.url).searchParams.get("videoId");

    if (videoId) {
      // ---- the Save dialog's rows (the user's own lists + the local WL) ----
      const tier = await resolveReadTier(req);
      if (!tier) {
        // WFX2-P37 — the local Watch-later row serves HERE TOO (the route's
        // own contract: "the local Watch-later row FIRST" — the pre-P37
        // not-connected branch answered playlists: [], which dropped the
        // WebFlix list from the dialog exactly when the user had no YouTube
        // connection — the local tier is the one lane that WORKS
        // unconnected; the connect notice stays for the YouTube-side rows).
        const watchLaterRow = await localWatchLaterRow(videoId, sessionUser);
        return NextResponse.json({
          playlists: [watchLaterRow],
          connected: false,
          kind: "youtube-not-connected",
          notice:
            "Connect your YouTube account to save to your YouTube playlists — Settings → YouTube connection",
          connectUrl: "/api/connection/youtube/oauth/start",
        });
      }
      const watchLaterRow = await localWatchLaterRow(videoId, sessionUser);
      const official = await officialListPlaylists(tier.accessToken);
      if (!official.ok) {
        // honest failure: the local Watch-later row still serves, the
        // YouTube-side rows honestly do not — never the operator's lists
        return NextResponse.json({
          playlists: [watchLaterRow],
          connected: true,
          notice:
            "Your YouTube playlists could not be read just now (the official API answered with an error) — try again shortly. Watch later below is the WebFlix list.",
        });
      }
      const rows = await Promise.all(
        official.data.map(async (p): Promise<PlaylistDto> => {
          const membership = await officialPlaylistMembership(tier.accessToken, p.id, videoId);
          return {
            id: p.id,
            name: p.title,
            isWatchLater: false,
            visibility: p.visibility,
            itemCount: p.itemCount,
            containsVideo: membership.ok ? membership.data.contains : false,
          };
        }),
      );
      return NextResponse.json({
        playlists: [watchLaterRow, ...rows],
        connected: true,
      });
    }

    // ---- the playlists page (the user's own official rows) ----
    const tier = await resolveReadTier(req);
    if (!tier) {
      return NextResponse.json({
        playlists: [] as PlaylistDTO[],
        loginRequired: false,
        unavailable: false,
        session: hasSession(),
        connected: false,
        notice:
          "Connect your YouTube account to see your playlists — Settings → YouTube connection",
      });
    }
    const official = await officialListPlaylists(tier.accessToken);
    if (!official.ok) {
      return NextResponse.json({
        playlists: [] as PlaylistDTO[],
        loginRequired: false,
        unavailable: true,
        session: hasSession(),
        connected: true,
        notice:
          "Your playlists could not be read just now (the official YouTube API answered with an error) — try again shortly",
      });
    }
    const playlists: PlaylistDTO[] = official.data.map((p) => ({
      id: p.id,
      title: p.title,
      visibility: p.visibility,
      isWatchLater: false,
      // the official row carries no creation date — honest empty, never a
      // fabricated timestamp
      createdAt: "",
      videoCount: p.itemCount,
      coverUrl: p.thumbUrl,
      videos: [],
    }));
    return NextResponse.json({
      playlists,
      loginRequired: false,
      unavailable: false,
      session: hasSession(),
      connected: true,
      notice:
        "Your playlists, read through your own connected YouTube account — WebFlix never reads someone else's.",
    });
  } catch (err) {
    console.error("GET /api/playlists failed", err);
    return NextResponse.json({ error: "Failed to load playlists" }, { status: 502 });
  }
}

/** The Save dialog's local Watch-later row (always first): the WebFlix-local
 * list, disclosed as local:true — containsVideo from the acting user's own
 * local truth, the count badge from the same store (0 on a store hiccup). */
async function localWatchLaterRow(
  videoId: string,
  sessionUser: WebFlixSessionUser | null,
): Promise<PlaylistDto & { local: true }> {
  const containsVideo = await readLocalSavedWatchLater(videoId, sessionUser);
  let itemCount = 0;
  if (sessionUser) {
    try {
      const user = await ensureShadowUser(sessionUser);
      const wl = await db.playlist.findFirst({
        where: { userId: user.id, isWatchLater: true },
        select: { id: true },
      });
      if (wl) {
        itemCount = await db.playlistItem.count({ where: { playlistId: wl.id } });
      }
    } catch {
      /* the count badge degrades to 0 — the contains flag stays truthful */
    }
  }
  return {
    id: "WL",
    name: "Watch later",
    isWatchLater: true,
    visibility: "private",
    itemCount,
    containsVideo,
    local: true,
  };
}

/**
 * POST /api/playlists { name|title, visibility } — WFX2-P36: CREATE a
 * playlist on the SIGNED-IN user's OWN YouTube account (playlists.insert,
 * the official lane with the API's own resource as the read-back). The
 * pre-P36 broker write (the operator's account) and the local-mirror
 * fallback are both RETIRED — no shared identity can serve this write.
 *
 * Response (201): { ok, effect: "created", verified, path, playlist } — the
 * playlist row carries BOTH consumer shapes (title/name, videoCount/itemCount)
 * so the playlists page and the watch-page Save dialog can both adopt it.
 */
export async function POST(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
    }
    const name = typeof body.name === "string" ? body.name : typeof body.title === "string" ? body.title : "";
    const title = name.trim();
    if (!title) {
      return NextResponse.json({ error: "Playlist name cannot be empty" }, { status: 400 });
    }
    const visibilityRaw = typeof body.visibility === "string" ? body.visibility : "private";
    const visibility =
      visibilityRaw === "public" || visibilityRaw === "unlisted" || visibilityRaw === "private"
        ? visibilityRaw
        : "private";

    const tier = await resolveActionTier(req);
    if (!tier.ok) throw tierError(tier.kind);
    const result = await proxyPlaylistCreate(title, visibility, tier);
    return NextResponse.json(
      {
        ok: true,
        effect: result.effect,
        verified: result.verified,
        path: result.path,
        playlist: {
          // the playlists page's PlaylistDTO shape
          id: result.playlist.id,
          title: result.playlist.title,
          visibility: result.playlist.visibility,
          isWatchLater: false,
          createdAt: "",
          videoCount: result.playlist.itemCount,
          coverUrl: result.playlist.thumbUrl,
          videos: [],
          // the Save dialog's PlaylistDto shape
          name: result.playlist.title,
          itemCount: result.playlist.itemCount,
          containsVideo: false,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    return errorResponse(err);
  }
}
