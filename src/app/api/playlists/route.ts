import { NextRequest, NextResponse } from "next/server";
import { getPlaylists, isSpecialPlaylistId } from "@/lib/youtube/playlists";
import { hasSession } from "@/lib/youtube/session";
import { rateLimit } from "@/lib/youtube/cache";
import { brokerAction, brokerOk, BrokerError } from "@/lib/broker";
import { resolveViewer } from "@/lib/watch/session";
import { listPlaylists, createPlaylist } from "@/lib/watch/playlist-service";
import type { PlaylistDTO } from "@/lib/types";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** Map a broker failure to the honest HTTP response. */
function brokerErrorResponse(err: BrokerError): NextResponse {
  if (err.kind === "bad-request") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  return NextResponse.json({ error: err.message }, { status: 502 });
}

/**
 * GET /api/playlists — two shapes, one route:
 *  - no query: the playlists PAGE's live list — the operator's REAL playlists
 *    (SSR /feed/playlists; Watch later = YouTube's own WL card when present).
 *    Response: { playlists, loginRequired, session } — honest login-required
 *    empties in public mode (no fake rows).
 *  - ?videoId=: the watch-page Save dialog's shape { playlists } with
 *    containsVideo flags (local mirror — the dialog's toggle contract; the
 *    broker-side save-dialog state lands in a later wave).
 */
export async function GET(req: NextRequest) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    if (!(await rateLimit(`playlists:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const videoId = new URL(req.url).searchParams.get("videoId");
    if (videoId) {
      const viewer = await resolveViewer(req.headers);
      const playlists = await listPlaylists(videoId, viewer.id);
      return NextResponse.json({ playlists });
    }
    const { playlists, loginRequired } = await getPlaylists();
    // YouTube's special cards (WL) are flagged for the UI's pinned layout
    const flagged: PlaylistDTO[] = playlists.map((p) => ({
      ...p,
      isWatchLater: isSpecialPlaylistId(p.id) ? p.id === "WL" : p.isWatchLater,
    }));
    return NextResponse.json({ playlists: flagged, loginRequired, session: hasSession() });
  } catch (err) {
    console.error("GET /api/playlists failed", err);
    return NextResponse.json({ error: "Failed to load playlists" }, { status: 502 });
  }
}

/**
 * POST /api/playlists { name|title, visibility } — CREATE a real playlist on
 * the operator's YouTube account (broker kind `playlist-create`, Tier-2).
 * The broker is the only writer (same-exact-effect law); the local mirror
 * path remains only as the honest offline fallback for the Save dialog.
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
    const visibility = ["private", "unlisted", "public"].includes(visibilityRaw) ? visibilityRaw : "private";

    // Tier-2: the real account is the source of truth — broker first
    const result = await brokerAction("playlist-create", {}, { title, visibility });
    if (brokerOk(result)) {
      const r = result as { ok: true; verified?: boolean; path?: string; detail?: Record<string, unknown> };
      const created: PlaylistDTO = {
        id: (r.detail?.playlistId as string | undefined) ?? "",
        title,
        visibility: visibility as PlaylistDTO["visibility"],
        isWatchLater: false,
        createdAt: new Date().toISOString(),
        videoCount: 0,
        coverUrl: null,
        videos: [],
      };
      return NextResponse.json(
        {
          ok: true,
          effect: "created",
          verified: r.verified ?? false,
          path: r.path ?? null,
          playlist: created,
        },
        { status: 201 }
      );
    }
    const err = result as BrokerError;
    if (err.kind === "offline") {
      // honest offline: the create cannot ride the real account without the
      // broker — surface it, and keep the local-mirror fallback ONLY for the
      // Save-dialog contract (documented in PERSONAL.md)
      try {
        const viewer = await resolveViewer(req.headers);
        const playlist = await createPlaylist(viewer.id, title, visibility);
        return NextResponse.json(
          {
            ok: true,
            effect: "created-local-fallback",
            playlist,
            note: "created on the WebFlix mirror only — the YouTube broker is offline",
          },
          { status: 201 }
        );
      } catch (localErr) {
        const status = (localErr as { status?: number }).status ?? 500;
        const message = localErr instanceof Error ? localErr.message : "Failed to create playlist";
        return NextResponse.json({ error: message }, { status });
      }
    }
    return brokerErrorResponse(err);
  } catch (err) {
    console.error("POST /api/playlists failed", err);
    return NextResponse.json({ error: "Failed to create playlist" }, { status: 500 });
  }
}
