import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { stageFor } from "@/lib/live/guests";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * GET /api/live-rooms/[id]/stage — the public stage board (host + guests
 * ONLY, resolved handles, states, guest cap). Public for public rooms and
 * link-holders of unlisted ones (Phase 1 link-share semantics); no session
 * yet answers an honest empty stage (sessionId ""). 200 `{ stage }`.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    const stage = await stageFor(id, sessionUser);
    return NextResponse.json({ stage });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-rooms/[id]/stage failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
