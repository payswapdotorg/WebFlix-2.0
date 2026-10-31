import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { answerQuestion } from "@/lib/live/questions";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/questions/[qid]/answer — host+moderator marks
 * the question answered (sets answeredAt). Idempotent: re-answering does
 * NOT reset answeredAt.
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
    const { question } = await answerQuestion(id, qid, sessionUser);
    return NextResponse.json({ question });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/questions/[qid]/answer failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
