import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { currentMatch } from "@/lib/live/matches";

export const dynamic = "force-dynamic";

/**
 * GET /api/live-rooms/[id]/matches/current — PUBLIC (anonymous OK): the
 * most recent match on the room's active session, any status (the UI
 * renders terminal states too), or `null` when none. Runs the lazy
 * wall-clock timeout first, so an expired match is settled (endReason
 * "timeout", winner derived, finals written) on read. 404 unknown room.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    const match = await currentMatch(id, sessionUser);
    return NextResponse.json({ match });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-rooms/[id]/matches/current failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
