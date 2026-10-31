import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createPoll } from "@/lib/live/polls";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import type { CreateLivePollInput } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/polls — create a poll (host+moderator only).
 * Body `CreateLivePollInput` (2..6 option labels, 1..80 chars each).
 * Creating closes any previous open poll (one-open-poll law). 200 { poll }.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let body: Partial<CreateLivePollInput> = {};
    try {
      body = (await req.json()) as Partial<CreateLivePollInput>;
    } catch {
      body = {};
    }
    const input: CreateLivePollInput = {
      question: typeof body.question === "string" ? body.question : "",
      options: Array.isArray(body.options) ? body.options : [],
    };
    const { poll } = await createPoll(id, sessionUser, input);
    return NextResponse.json({ poll });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/polls failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
