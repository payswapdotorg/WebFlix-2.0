import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus, resolveLiveIdentity } from "@/lib/live/rooms";
import { listStudioSessions } from "@/lib/live/analytics";

export const dynamic = "force-dynamic";

/**
 * GET /api/studio/live-sessions — the studio panel feed (work order §4H).
 * Signed-in callers only; host-scoped by construction (the query filters on
 * the caller's own rooms). Answers `{ sessions }` — each row carries the
 * room summary, the room's most recent ENDED session, the snapshot row if
 * present (raw read — the room analytics GET is the one that re-derives)
 * and the replay asset status, newest ended session first (limit 20).
 */
export async function GET(req: Request) {
  try {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const identity = await resolveLiveIdentity(sessionUser);
    const sessions = await listStudioSessions(identity.id);
    return NextResponse.json({ sessions });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/studio/live-sessions failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
