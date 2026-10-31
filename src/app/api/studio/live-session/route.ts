import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  findHostActiveRoom,
  LiveDomainError,
  liveErrorStatus,
  resolveLiveIdentity,
} from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * GET /api/studio/live-session — the console re-attach probe (P68).
 *
 * Signed-in callers only; host-scoped by construction (the domain query
 * filters on the caller's own rooms, ANY visibility). Answers
 * `{ room: LiveRoomDto | null }` — the caller's ACTIVE live room, or null
 * when nothing is running. The studio console offers a REAL re-attach on
 * this room through the existing host-rung token route (the rung is derived
 * server-side from the room's hostId — the caller cannot claim it) instead
 * of a fresh Go-live form that would orphan the running session.
 *
 * Honest failures: 401 unauthenticated; 502 provider-failed for anything
 * unexpected. A signed-out caller is the common case for a cold browser —
 * the console stays silent on the 401 and keeps the preflight flow.
 */
export async function GET(req: Request) {
  try {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const identity = await resolveLiveIdentity(sessionUser);
    const room = await findHostActiveRoom(identity.id);
    return NextResponse.json({ room });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/studio/live-session failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
