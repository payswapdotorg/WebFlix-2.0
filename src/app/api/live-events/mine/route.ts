import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { listMyEvents } from "@/lib/live/events";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * GET /api/live-events/mine — the caller's own events, any status, newest
 * first. STATIC segment: Next.js gives this route precedence over the
 * dynamic [id] route, so "mine" is never read as an event id.
 */
export async function GET(req: Request) {
  try {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const { events } = await listMyEvents(sessionUser);
    return NextResponse.json({ events });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-events/mine failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
