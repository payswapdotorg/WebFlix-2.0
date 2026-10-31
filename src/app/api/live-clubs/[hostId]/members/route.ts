import { NextResponse } from "next/server";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { listClubMembers } from "@/lib/live/clubs";

export const dynamic = "force-dynamic";

/**
 * GET /api/live-clubs/[hostId]/members?cursor= — the paged member roster
 * (top by points, CLUB_MEMBERS_PAGE per page; the cursor is the previous
 * page's last member id). Anonymous OK (the roster is a read surface, like
 * the overview). 200 `{ clubId, members, nextCursor }`; 404 unknown host;
 * 400 for an unknown/foreign cursor.
 */
export async function GET(req: Request, ctx: { params: Promise<{ hostId: string }> }) {
  try {
    const { hostId } = await ctx.params;
    const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;
    const page = await listClubMembers(hostId, cursor ?? undefined);
    return NextResponse.json(page);
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-clubs/[hostId]/members failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
