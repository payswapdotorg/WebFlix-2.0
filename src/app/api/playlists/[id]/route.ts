import { NextRequest, NextResponse } from "next/server";
import { getPlaylistItems, isSpecialPlaylistId } from "@/lib/youtube/playlists";
import { rateLimit } from "@/lib/youtube/cache";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import {
  proxyPlaylistDelete,
  proxyPlaylistUpdate,
  resolveActionTier,
} from "@/lib/watch/action-proxy";
import { errorResponse } from "@/lib/watch/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/playlists/[id]?cursor= — one page of the playlist's items.
 * WFX2-P36: the PUBLIC PL… reads (browse VL<playlistId>) stay exactly as
 * they are — public content, no identity involved. YouTube's special lists
 * WL/LL are the honest per-user notice envelope instead: the pre-P36 branch
 * login-gated on the OPERATOR session (one person's Watch Later / Liked list
 * served to every signed-in user — the exact cross-user leak the P36 work
 * order closes), and neither list has an official per-user read API.
 *
 * Response (special): { loginRequired: false, special: true, videos: [],
 * notice } — the notice hands Watch later off to the WebFlix-local save
 * button and the rest to YouTube's own pages.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id || !/^[\w-]{2,64}$/.test(id)) {
      return NextResponse.json({ error: "invalid playlist id" }, { status: 400 });
    }
    if (isSpecialPlaylistId(id)) {
      // WFX2-P36 — the honest per-user notice (never the operator's list)
      return NextResponse.json({
        playlist: null,
        videos: [],
        nextCursor: null,
        loginRequired: false,
        unavailable: false,
        special: true,
        notice:
          "YouTube's Watch Later / Liked lists have no official API — your WebFlix Watch later lives in the save button (local), and YouTube's own page has the rest",
      });
    }
    if (!(await rateLimit(`playlist:${id}:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;
    const page = await getPlaylistItems(id, { cursor: cursor || undefined });
    if (page.notFound) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }
    return NextResponse.json({
      playlist: page.playlist,
      videos: page.videos,
      nextCursor: page.nextCursor,
      loginRequired: page.loginRequired,
      // P22-B: a session IS configured but the read was not served — the
      // honest unavailable state (never a login ask for a signed-in user)
      unavailable: page.unavailable,
      special: isSpecialPlaylistId(id),
    });
  } catch (err) {
    console.error("GET /api/playlists/[id] failed", err);
    return NextResponse.json({ error: "Failed to load playlist" }, { status: 502 });
  }
}

/**
 * DELETE /api/playlists/[id] — WFX2-P36: delete the playlist from the
 * SIGNED-IN user's OWN account (playlists.delete — the official lane). The
 * special lists WL/LL cannot be deleted — honest 400.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    const { id } = await ctx.params;
    if (!id || !/^[\w-]{2,64}$/.test(id)) {
      return NextResponse.json({ error: "invalid playlist id" }, { status: 400 });
    }
    if (isSpecialPlaylistId(id)) {
      return NextResponse.json(
        { error: "Watch later and Liked videos are YouTube's own lists and cannot be deleted" },
        { status: 400 }
      );
    }
    const tier = await resolveActionTier(req);
    const result = await proxyPlaylistDelete(id, tier);
    return NextResponse.json({
      ok: true,
      effect: result.effect,
      verified: result.verified,
      path: result.path,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * PATCH /api/playlists/[id] — WFX2-P36: RENAME / privacy switch / description
 * edit on the SIGNED-IN user's OWN account (playlists.update — the official
 * lane, partial-safe via fetch-merge-put; the API response itself is the
 * read-back so verified:true). Body: { title?, description?, visibility? }.
 * The special lists WL/LL cannot be edited — honest 400.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await getSessionUser(req))) return authRequiredResponse();
  try {
    const { id } = await ctx.params;
    if (!id || !/^[\w-]{2,64}$/.test(id)) {
      return NextResponse.json({ error: "invalid playlist id" }, { status: 400 });
    }
    if (isSpecialPlaylistId(id)) {
      return NextResponse.json(
        {
          error:
            "Watch later and Liked videos are YouTube's own lists and cannot be renamed or have their privacy changed",
        },
        { status: 400 }
      );
    }
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
    }
    const title = typeof body.title === "string" ? body.title : undefined;
    const description = typeof body.description === "string" ? body.description : undefined;
    const visibilityRaw = typeof body.visibility === "string" ? body.visibility : undefined;
    const visibility =
      visibilityRaw && ["public", "unlisted", "private"].includes(visibilityRaw)
        ? (visibilityRaw as "public" | "unlisted" | "private")
        : undefined;
    if (title === undefined && description === undefined && visibility === undefined) {
      return NextResponse.json(
        { error: "at least one of title, description, or visibility is required" },
        { status: 400 }
      );
    }
    if (title !== undefined && title.trim().length === 0) {
      return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
    }
    const tier = await resolveActionTier(req);
    const result = await proxyPlaylistUpdate(id, { title, description, visibility }, tier);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
