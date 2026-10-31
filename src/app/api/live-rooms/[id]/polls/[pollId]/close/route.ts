import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { closePoll } from "@/lib/live/polls";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/polls/[pollId]/close — close a poll
 * (host+moderator). Idempotent: an already-closed poll answers 200 with
 * the dto (closedAt never bumped).
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; pollId: string }> },
) {
  try {
    const { id, pollId } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const { poll } = await closePoll(id, pollId, sessionUser);
    return NextResponse.json({ poll });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/polls/[pollId]/close failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
