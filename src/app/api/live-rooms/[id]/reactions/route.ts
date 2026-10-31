import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { sendReactionBatch } from "@/lib/live/reactions";
import type { SendLiveReactionBatchInput } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/reactions — accept ONE client batching window of
 * tap reactions. Body SendLiveReactionBatchInput (clientBatchId is the
 * idempotency key); the server clamps count to 1..REACTION_BATCH_MAX and
 * answers 200 `{ total }` — the server-computed SUM over the session's
 * accepted batches. 403 reactions-disabled/not-live/banned; 429 per
 * RATE_LIMITS.reactions. A retried clientBatchId returns the current total
 * without a second row.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    let body: SendLiveReactionBatchInput = {} as SendLiveReactionBatchInput;
    try {
      body = (await req.json()) as SendLiveReactionBatchInput;
    } catch {
      body = {} as SendLiveReactionBatchInput; // invalid JSON → validation errors below
    }
    const { total } = await sendReactionBatch(id, sessionUser, body);
    return NextResponse.json({ total });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/reactions failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
