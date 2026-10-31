import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  startSession,
  LiveDomainError,
  liveErrorStatus,
} from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/sessions — the host's Go Live.
 *
 * Host-only (the domain layer enforces hostId === caller). Mints the host's
 * scoped publish token in the same answer (start + join in one roundtrip).
 * Honest failures: 503 provider-not-configured (LIVE env missing), 409
 * conflict when a session is already active, 403 non-host.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const { room, playback } = await startSession(id, sessionUser);
    return NextResponse.json({ room, playback }, { status: 201 });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/sessions failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
