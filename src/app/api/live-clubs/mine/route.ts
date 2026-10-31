import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { getMyClub } from "@/lib/live/clubs";

export const dynamic = "force-dynamic";

/**
 * GET /api/live-clubs/mine — the frozen route-table spelling (contracts §5)
 * of "the caller's own club". Same surface as GET /api/live-clubs:
 * `{ club }` or `{ club: null }`; anonymous → 401.
 */
export async function GET(req: Request) {
  try {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const club = await getMyClub(sessionUser);
    return NextResponse.json({ club });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-clubs/mine failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
