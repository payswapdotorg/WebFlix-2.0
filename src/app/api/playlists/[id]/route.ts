import { NextRequest, NextResponse } from "next/server";
import { getPlaylistItems, isSpecialPlaylistId } from "@/lib/youtube/playlists";
import { rateLimit } from "@/lib/youtube/cache";
import { brokerAction, brokerOk, BrokerError } from "@/lib/broker";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import { proxyPlaylistUpdate } from "@/lib/watch/action-proxy";
import { ApiError } from "@/lib/watch/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/playlists/[id]?cursor= — one page of the playlist's REAL items
 * (browse `VL<playlistId>` — public playlists work without auth; YouTube's
 * special lists WL/LL are auth-gated and answer the honest login-required
 * state in public mode). `cursor` pages via browse continuations.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!id || !/^[\w-]{2,64}$/.test(id)) {
      return NextResponse.json({ error: "invalid playlist id" }, { status: 400 });
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
      special: isSpecialPlaylistId(id),
    });
  } catch (err) {
    console.error("GET /api/playlists/[id] failed", err);
    return NextResponse.json({ error: "Failed to load playlist" }, { status: 502 });
  }
}

/**
 * DELETE /api/playlists/[id] — delete the playlist from the operator's real
 * account (broker kind `playlist-delete`, Tier-2). The special lists WL/LL
 * cannot be deleted — honest 400.
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
    const result = await brokerAction("playlist-delete", { playlistId: id });
    if (!brokerOk(result)) {
      const err = result as BrokerError;
      if (err.kind === "bad-request") {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    const r = result as { ok: true; verified?: boolean; path?: string };
    return NextResponse.json({
      ok: true,
      effect: "deleted",
      verified: r.verified ?? false,
      path: r.path ?? null,
    });
  } catch (err) {
    console.error("DELETE /api/playlists/[id] failed", err);
    return NextResponse.json({ error: "Failed to delete playlist" }, { status: 500 });
  }
}

/**
 * PATCH /api/playlists/[id] — RENAME / privacy switch / description edit on
 * the operator's real YouTube account (broker kind `playlist-update`,
 * Tier-2). Body: { title?, description?, visibility? } — only the present
 * fields ride the broker payload. The special lists WL/LL cannot be edited
 * (YouTube's own lists) — honest 400. Response: {ok, effect, fields, verified,
 * path?}; verified:false when the broker's dialog closed but the header did
 * not re-render the new title within the deadline (honest unverified).
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
    const result = await proxyPlaylistUpdate(id, { title, description, visibility });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("PATCH /api/playlists/[id] failed", err);
    return NextResponse.json({ error: "Failed to update playlist" }, { status: 500 });
  }
}
