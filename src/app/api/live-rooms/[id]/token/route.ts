import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  mintJoinToken,
  LiveDomainError,
  liveErrorStatus,
} from "@/lib/live/rooms";
import type { MintLiveTokenInput } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/token — mint a short-lived, room-scoped join
 * token for the room's ACTIVE session. The host identity gets the host
 * rung; everyone else gets the viewer rung (subscribe-only). The guest
 * rung requires the Phase 3 invite path and is not mintable today.
 * The token lives ONLY in the caller's memory — it never enters a URL,
 * a log line, or a persisted row.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let body: MintLiveTokenInput = {};
    try {
      body = (await req.json()) as MintLiveTokenInput;
    } catch {
      body = {};
    }
    const playback = await mintJoinToken(id, sessionUser.id, body.role === "guest" ? "guest" : "viewer");
    return NextResponse.json({ playback });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/token failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
