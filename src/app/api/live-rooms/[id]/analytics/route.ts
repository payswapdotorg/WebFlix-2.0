import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { LiveDomainError, liveErrorStatus, resolveLiveIdentity } from "@/lib/live/rooms";
import { computeAnalyticsSnapshot } from "@/lib/live/analytics";
import { RATE_LIMITS } from "@/lib/live/permissions";
import { rateLimit } from "@/lib/youtube/cache";

export const dynamic = "force-dynamic";

/**
 * GET /api/live-rooms/[id]/analytics — host-only creator analytics
 * (work order §4H; the ADR-0008 analytics law).
 *
 * The read is AUTHORITATIVE and self-healing: it ALWAYS re-derives the
 * snapshot from durable rows via computeAnalyticsSnapshot (which upserts
 * idempotently on the session), so a failed best-effort end-hook is healed
 * by the next host read. 200 `{ snapshot: LiveAnalyticsSnapshotDto }`;
 * 401 unauthenticated / 403 non-host / 404 unknown room or session /
 * 429 RATE_LIMITS.analytics. Works on ended rooms (analytics is an
 * after-the-fact read); the room's most recent session is the subject.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id: roomId } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const identity = await resolveLiveIdentity(sessionUser);
    const room = await db.liveRoom.findUnique({
      where: { id: roomId },
      select: { hostId: true },
    });
    if (!room) throw new LiveDomainError("not-found");
    if (room.hostId !== identity.id) throw new LiveDomainError("forbidden");
    if (
      !(await rateLimit(`wf:live:analytics:${roomId}:${identity.id}`, RATE_LIMITS.analytics))
    ) {
      throw new LiveDomainError("rate-limited");
    }
    const session = await db.liveSession.findFirst({
      where: { roomId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!session) throw new LiveDomainError("not-found", "no-session");
    const snapshot = await computeAnalyticsSnapshot(session.id);
    return NextResponse.json({ snapshot });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-rooms/[id]/analytics failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
