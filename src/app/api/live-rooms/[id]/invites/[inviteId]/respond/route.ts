import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { respondInvite } from "@/lib/live/guests";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import type { RespondLiveInviteInput } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/invites/[inviteId]/respond — body
 * RespondLiveInviteInput. The RESPONDER is the invitee when the row is a
 * host-invite, and the host when the row is a guest-request; accept on a
 * live session upserts the invitee's participant rung (role "guest", state
 * "connected") and re-publishes the stage. 200 `{ invite }`; 409
 * invite-resolved / invite-expired / stage-full; 403 otherwise; 400 for an
 * unknown action.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; inviteId: string }> },
) {
  try {
    const { id, inviteId } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let body: RespondLiveInviteInput = {} as RespondLiveInviteInput;
    try {
      body = (await req.json()) as RespondLiveInviteInput;
    } catch {
      body = {} as RespondLiveInviteInput; // → "action must be accept or decline" below
    }
    const invite = await respondInvite(id, inviteId, sessionUser, body);
    return NextResponse.json({ invite });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/invites/[inviteId]/respond failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
