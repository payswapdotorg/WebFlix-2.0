import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { hideQuestion } from "@/lib/live/questions";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/questions/[qid]/hide — host+moderator tombstone
 * (sets hiddenAt). Idempotent: hiddenAt is never re-stamped; hidden
 * questions leave public lists but stay in the audit set.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; qid: string }> },
) {
  try {
    const { id, qid } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const { question } = await hideQuestion(id, qid, sessionUser);
    return NextResponse.json({ question });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/questions/[qid]/hide failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
