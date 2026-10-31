import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { cancelMatch } from "@/lib/live/matches";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/matches/[matchId]/cancel — host cancels an
 * ACTIVE match: status "cancelled", NO winner, NO finals; the banked
 * LiveScoreEvent rows stand (audit). 200 `{ match: LiveMatchDto }`; 403
 * forbidden; 404 unknown room / foreign matchId; 409 already terminal.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; matchId: string }> }) {
  try {
    const { id, matchId } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) throw new LiveDomainError("unauthenticated");
    const match = await cancelMatch(id, matchId, sessionUser);
    return NextResponse.json({ match });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/matches/[matchId]/cancel failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
