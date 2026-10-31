import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { registerEvent, unregisterEvent } from "@/lib/live/events";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-events/[id]/register — upsert the caller's unique
 * (eventId, userId) registration row. Idempotent success; canceled/
 * completed events answer 409 conflict.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const { event } = await registerEvent(id, sessionUser);
    return NextResponse.json({ event });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-events/[id]/register failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}

/**
 * DELETE /api/live-events/[id]/register — remove the caller's registration
 * row when present; idempotent success either way.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const { event } = await unregisterEvent(id, sessionUser);
    return NextResponse.json({ event });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("DELETE /api/live-events/[id]/register failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
