import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { cancelInvite } from "@/lib/live/guests";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/live-rooms/[id]/invites/[inviteId] — retract one pending row
 * (the row's creator or the room host). 200 `{ invite }` with status
 * "cancelled"; 403 bystanders; 409 invite-resolved for non-pending rows.
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; inviteId: string }> },
) {
  try {
    const { id, inviteId } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const invite = await cancelInvite(id, inviteId, sessionUser);
    return NextResponse.json({ invite });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("DELETE /api/live-rooms/[id]/invites/[inviteId] failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
