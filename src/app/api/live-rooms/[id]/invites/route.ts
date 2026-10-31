import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createInvite, listInvites } from "@/lib/live/guests";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import type { CreateLiveInviteInput } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/invites — the host posts { inviteeId } (an
 * invitation) or a signed-in viewer posts {} (a self-request). 200
 * `{ invite }`; 403 guests-disabled/not-live/banned (or plain forbidden
 * when a non-host names a third user); 409 invite-pending / stage-full /
 * invalid-invitee; 429 RATE_LIMITS.inviteCreate.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let body: CreateLiveInviteInput = {};
    try {
      body = (await req.json()) as CreateLiveInviteInput;
    } catch {
      body = {}; // absent/invalid JSON → self-request semantics
    }
    const invite = await createInvite(id, sessionUser, body);
    return NextResponse.json({ invite });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/invites failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}

/**
 * GET /api/live-rooms/[id]/invites — the host gets the room's stage queue
 * (pending first, newest first, then recent resolved rows, capped at 50);
 * everyone else gets only their own rows. Expired pendings sweep to
 * "expired" on read (lazy, idempotent). 401 anonymous.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    const invites = await listInvites(id, sessionUser);
    return NextResponse.json({ invites });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-rooms/[id]/invites failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
