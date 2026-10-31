import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { joinClub } from "@/lib/live/clubs";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-clubs/[hostId]/join — join the host's club (signed-in).
 * Idempotent: an existing member gets the same 200 `{ ok: true }` (never a
 * second row, never an error). 403 banned (active ban sanction from the
 * host's rooms) / club-full (CLUB_MEMBERS_MAX); 404 unknown host;
 * 429 per RATE_LIMITS.clubJoin.
 */
export async function POST(req: Request, ctx: { params: Promise<{ hostId: string }> }) {
  try {
    const { hostId } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const result = await joinClub(sessionUser, hostId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-clubs/[hostId]/join failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
