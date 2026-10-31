import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { startMatch } from "@/lib/live/matches";
import type { StartLiveMatchInput } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/matches — host starts a match between ACTIVE
 * stage participants of the current session. Body StartLiveMatchInput;
 * answers 200 `{ match: LiveMatchDto }`. 401 unauthenticated; 403
 * forbidden / not-live; 404 unknown room; 409 match-active /
 * invalid-roster; 429 per RATE_LIMITS.matchStart.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) throw new LiveDomainError("unauthenticated");
    let body: StartLiveMatchInput = {} as StartLiveMatchInput;
    try {
      body = (await req.json()) as StartLiveMatchInput;
    } catch {
      body = {} as StartLiveMatchInput; // invalid JSON → validation errors below
    }
    const match = await startMatch(id, sessionUser, body);
    return NextResponse.json({ match });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/matches failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
