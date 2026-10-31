import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { getClubOverview } from "@/lib/live/clubs";

export const dynamic = "force-dynamic";

/**
 * GET /api/live-clubs/[hostId] — the club overview for THIS caller
 * (anonymous callers welcome). 200 `{ overview: LiveFanClubOverviewDto }` —
 * club + the caller's membership (null when anonymous/not a member) +
 * derived missions + top members + the host's current LIVE room only when
 * the caller may see it (a "members" room requires club membership; the
 * host always sees their own). 404 when the host has no club.
 */
export async function GET(req: Request, ctx: { params: Promise<{ hostId: string }> }) {
  try {
    const { hostId } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    const overview = await getClubOverview(sessionUser, hostId);
    return NextResponse.json({ overview });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-clubs/[hostId] failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
