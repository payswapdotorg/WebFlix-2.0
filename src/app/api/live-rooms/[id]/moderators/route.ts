import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { grantModerator, revokeModerator } from "@/lib/live/moderation";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/moderators — grant moderation on the room.
 * HOST only; body { userId }; upserts the (roomId, userId) grant row —
 * a previously-revoked grant is re-activated. 200 { moderator }.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let userId = "";
    try {
      const body = (await req.json()) as { userId?: unknown };
      if (typeof body?.userId === "string") userId = body.userId;
    } catch {
      // fall through with an empty userId → the domain answers 400 invalid
    }
    const { moderator } = await grantModerator(id, sessionUser, userId);
    return NextResponse.json({ moderator });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/moderators failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}

/**
 * DELETE /api/live-rooms/[id]/moderators — soft-revoke the grant
 * (revokedAt/revokedBy; the ledger row survives). HOST only; body
 * { userId } with a `?userId=` fallback for curl friendliness.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let userId = "";
    try {
      const body = (await req.json()) as { userId?: unknown };
      if (typeof body?.userId === "string") userId = body.userId;
    } catch {
      // no/invalid JSON body — fall back to the query param below
    }
    if (!userId) {
      userId = new URL(req.url).searchParams.get("userId") ?? "";
    }
    const { moderator } = await revokeModerator(id, sessionUser, userId);
    return NextResponse.json({ moderator });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("DELETE /api/live-rooms/[id]/moderators failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
