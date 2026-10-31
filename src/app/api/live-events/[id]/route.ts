import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  getEvent,
  updateEvent,
  type UpdateLiveEventPatch,
} from "@/lib/live/events";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * GET /api/live-events/[id] — public; carries the caller's `registered`
 * flag (null for anonymous) and the row-derived registrationCount.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    const { event } = await getEvent(id, sessionUser);
    return NextResponse.json({ event });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-events/[id] failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}

/**
 * PATCH /api/live-events/[id] — creator only (title/description/
 * scheduledFor, validated like create). Bodies are parsed defensively:
 * invalid JSON → {} → the domain validation answers.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const patch: UpdateLiveEventPatch = {};
    if (typeof body.title === "string") patch.title = body.title;
    if (typeof body.description === "string" || body.description === null) {
      patch.description = body.description;
    }
    if (typeof body.scheduledFor === "string") patch.scheduledFor = body.scheduledFor;
    const { event } = await updateEvent(id, sessionUser, patch);
    return NextResponse.json({ event });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("PATCH /api/live-events/[id] failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
