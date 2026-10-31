import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { removeGuest } from "@/lib/live/guests";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/live-rooms/[id]/stage/[userId] — host removes a guest:
 * participant state → "removed" (row kept), best-effort
 * adapter().removeParticipant (never fatal), fresh stage re-published.
 * 200 `{ stage }`; 403 non-host (or the host identity itself); 404 for a
 * userId that is not a current guest participant.
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    const { id, userId } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const stage = await removeGuest(id, userId, sessionUser);
    return NextResponse.json({ stage });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("DELETE /api/live-rooms/[id]/stage/[userId] failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
