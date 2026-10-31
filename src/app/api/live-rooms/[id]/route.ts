import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getRoom } from "@/lib/live/rooms";
import { liveActorFor, activeSanctions, roomPolicyFor, activeSessionFor } from "@/lib/live/permissions";
import { buildPolicyDto } from "@/lib/live/policy";

export const dynamic = "force-dynamic";

/**
 * GET /api/live-rooms/[id] — one room's fresh state (session lifecycle,
 * approximate viewer count, host identity). Guest callers still receive
 * public/unlinked rooms (link-sharing semantics for unlisted); discovery
 * never lists unlisted ones.
 *
 * Phase 2 (additive): signed-in callers additionally receive the
 * caller-scoped interaction `policy` (roles + sanctions computed
 * server-side) — anonymous callers get no policy block at all.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    const room = await getRoom(id, sessionUser);
    if (!room) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    let policy = undefined;
    if (sessionUser) {
      const actor = await liveActorFor(id, sessionUser);
      const [sanctions, policyRow, session] = await Promise.all([
        activeSanctions(id, actor.id),
        roomPolicyFor(id),
        activeSessionFor(id),
      ]);
      if (policyRow) {
        policy = buildPolicyDto({
          room: policyRow,
          actor,
          sanctions,
          sessionLive: session !== null && session.status !== "ended",
        });
      }
    }
    return NextResponse.json({ room: { ...room, policy } });
  } catch (err) {
    console.error("GET /api/live-rooms/[id] failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
