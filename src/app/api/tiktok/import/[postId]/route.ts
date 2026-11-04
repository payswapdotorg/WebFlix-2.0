import { NextRequest, NextResponse } from "next/server";
import { flipTikTokImportVisibility, removeTikTokImport, importUserId } from "@/lib/tiktok/imports";
import { getSessionUser, authRequiredResponse } from "@/lib/auth/session";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/tiktok/import/[postId] — the OWNER's visibility flip (the
 * curator rule, ADR 0013 §7): `{ visibility: "private" | "public" }`.
 * "public" admits the post to every viewer's composed universe; "private"
 * pulls it back to the owner's feed only. Non-owners get 404 (no
 * existence leak); an unknown value gets 400.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ postId: string }> }) {
  try {
    if (!(await rateLimit(`tiktok:import:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return authRequiredResponse();
    const userId = await importUserId(sessionUser);
    const { postId } = await ctx.params;

    let body: { visibility?: unknown };
    try {
      body = (await req.json()) as { visibility?: unknown };
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const result = await flipTikTokImportVisibility({
      postId,
      userId,
      visibility: body?.visibility,
    });
    if (!result.ok) {
      return result.error === "not-found"
        ? NextResponse.json({ error: "Import not found" }, { status: 404 })
        : NextResponse.json(
            { error: 'visibility must be "private" or "public"' },
            { status: 400 },
          );
    }
    return NextResponse.json({ postId, visibility: result.visibility }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("PATCH /api/tiktok/import/[postId] failed", err);
    return NextResponse.json({ error: "Failed to update the TikTok import" }, { status: 502 });
  }
}

/**
 * DELETE /api/tiktok/import/[postId] — the OWNER's un-import: the row
 * leaves the library (the feed membership follows). Non-owners get 404.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ postId: string }> }) {
  try {
    if (!(await rateLimit(`tiktok:import:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return authRequiredResponse();
    const userId = await importUserId(sessionUser);
    const { postId } = await ctx.params;

    const result = await removeTikTokImport({ postId, userId });
    if (!result.ok) {
      return NextResponse.json({ error: "Import not found" }, { status: 404 });
    }
    return NextResponse.json({ postId, removed: true }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("DELETE /api/tiktok/import/[postId] failed", err);
    return NextResponse.json({ error: "Failed to remove the TikTok import" }, { status: 502 });
  }
}
