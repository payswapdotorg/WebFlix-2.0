import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { votePoll } from "@/lib/live/polls";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/polls/[pollId]/vote — cast or MOVE the caller's
 * single vote (body { optionId }). One vote per (poll, user); 409 when the
 * poll is closed. Counts are derived server-side from vote rows.
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
    let body: { optionId?: unknown } = {};
    try {
      body = (await req.json()) as { optionId?: unknown };
    } catch {
      body = {};
    }
    const optionId = typeof body.optionId === "string" ? body.optionId : "";
    const { poll } = await votePoll(id, pollId, sessionUser, optionId);
    return NextResponse.json({ poll });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/polls/[pollId]/vote failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
