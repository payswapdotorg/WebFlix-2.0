import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { endMatch } from "@/lib/live/matches";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/matches/[matchId]/end — host ends an ACTIVE
 * match early: endReason "host", winner derived from the current SUM, one
 * final LiveScoreSnapshot per team (the result of record). 200
 * `{ match: LiveMatchDto }`; 403 forbidden; 404 unknown room / foreign
 * matchId; 409 already terminal (a match expired past endsAt was settled
 * by the lazy timeout with endReason "timeout" and cannot be host-ended).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; matchId: string }> }) {
  try {
    const { id, matchId } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) throw new LiveDomainError("unauthenticated");
    const match = await endMatch(id, matchId, sessionUser);
    return NextResponse.json({ match });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/matches/[matchId]/end failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
