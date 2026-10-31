import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { startReplay } from "@/lib/live/replays";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import type { StartReplayInput } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/replay/start — host only, live session
 * required. Body `StartReplayInput` (sink defaults to "host-capture").
 * 200 `{ asset }` (status `recording`); 403 forbidden / "not-live"; 404;
 * 409 "replay-active" / "egress-not-configured"; 429 replayStart.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let body: StartReplayInput = {};
    try {
      body = (await req.json()) as StartReplayInput;
    } catch {
      body = {}; // absent/invalid JSON → default sink
    }
    const asset = await startReplay(id, sessionUser, body);
    return NextResponse.json({ asset });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/replay/start failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
