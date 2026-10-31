import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getRoom } from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * GET /api/live-rooms/[id] — one room's fresh state (session lifecycle,
 * approximate viewer count, host identity). Guest callers still receive
 * public/unlinked rooms (link-sharing semantics for unlisted); discovery
 * never lists unlisted ones.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    const room = await getRoom(id, sessionUser);
    if (!room) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    return NextResponse.json({ room });
  } catch (err) {
    console.error("GET /api/live-rooms/[id] failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
