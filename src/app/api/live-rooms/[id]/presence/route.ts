import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { heartbeat } from "@/lib/live/presence";
import type { LivePresenceDto } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/presence — the viewer presence heartbeat.
 * Upserts the caller's LiveParticipant row on the ACTIVE session (state
 * "connected", lastSeenAt now) and answers 200 `{ presence }` with the
 * server-computed approximate viewer count. 429 per RATE_LIMITS.presence;
 * 403 not-live when the room has no active session.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    const presence: LivePresenceDto = await heartbeat(id, sessionUser);
    return NextResponse.json({ presence });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/presence failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
