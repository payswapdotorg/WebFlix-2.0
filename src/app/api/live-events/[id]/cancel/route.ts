import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { cancelEvent } from "@/lib/live/events";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-events/[id]/cancel — creator only; sets status
 * "canceled". Idempotent: an already-canceled event answers 200.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const { event } = await cancelEvent(id, sessionUser);
    return NextResponse.json({ event });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-events/[id]/cancel failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
