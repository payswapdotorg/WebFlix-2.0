import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { listModeration, performModeration } from "@/lib/live/moderation";
import type { PerformLiveModerationInput } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/moderation — perform one audited moderation
 * action (PerformLiveModerationInput). Host + granted moderators; the
 * kill-switch class (slow-mode / chat-enable / chat-disable) is host-only.
 * Every successful call appends exactly one LiveModerationAction row and
 * answers 200 { action: LiveModerationActionDto }.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let body: PerformLiveModerationInput = {} as PerformLiveModerationInput;
    try {
      body = (await req.json()) as PerformLiveModerationInput;
    } catch {
      body = {} as PerformLiveModerationInput;
    }
    const { action } = await performModeration(id, sessionUser, body);
    return NextResponse.json({ action });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/moderation failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}

/**
 * GET /api/live-rooms/[id]/moderation?limit≤100 — the room's audit trail
 * (host + moderators, newest first).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const rawLimit = new URL(req.url).searchParams.get("limit");
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    const { actions } = await listModeration(id, sessionUser, { limit });
    return NextResponse.json({ actions });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-rooms/[id]/moderation failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
