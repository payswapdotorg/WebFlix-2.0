import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  endRoom,
  LiveDomainError,
  liveErrorStatus,
} from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/end — the host's End live.
 *
 * Host-only. Teardown order is the honest one: the provider room is
 * destroyed FIRST (a provider failure leaves app state live and returns
 * the real error — no fake success), then the session is marked ended and
 * the room flips to "ended". Repeated ends are idempotent no-ops. The
 * provider's own room_finished webhook is the independent reconciliation
 * backstop (it dedupes safely if the host path already ended everything).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const room = await endRoom(id, sessionUser);
    return NextResponse.json({ room });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/end failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
