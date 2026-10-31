import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { leaveClub } from "@/lib/live/clubs";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-clubs/[hostId]/leave — leave the host's club (signed-in).
 * Idempotent: not being a member is a no-op success (200 `{ ok: true }`),
 * never an error. 404 unknown host; 429 per RATE_LIMITS.clubLeave.
 */
export async function POST(req: Request, ctx: { params: Promise<{ hostId: string }> }) {
  try {
    const { hostId } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const result = await leaveClub(sessionUser, hostId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-clubs/[hostId]/leave failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
