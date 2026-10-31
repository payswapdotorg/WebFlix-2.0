import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { createEvent, listUpcomingEvents } from "@/lib/live/events";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import type { CreateLiveEventInput } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/live-events?status=scheduled — public discovery of upcoming
 * events, `scheduledFor` ascending (default 24, max 48). Anonymous reads
 * are allowed (registered is null for guests).
 */
export async function GET(req: Request) {
  try {
    const statusParam = new URL(req.url).searchParams.get("status");
    // The frozen discovery list is the upcoming ("scheduled") one; any other
    // status filter is not a public surface yet — answer honestly.
    if (statusParam !== null && statusParam !== "scheduled") {
      return NextResponse.json({ error: "invalid", message: "status must be scheduled" }, { status: 400 });
    }
    const limitRaw = new URL(req.url).searchParams.get("limit");
    const parsedLimit = limitRaw === null ? Number.NaN : Number(limitRaw);
    const sessionUser = await getSessionUser(req);
    const { events } = await listUpcomingEvents(sessionUser, {
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    });
    return NextResponse.json({ events });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-events failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}

/**
 * POST /api/live-events — any signed-in user schedules an event
 * (RATE_LIMITS.eventCreate). Body `CreateLiveEventInput`; 200 { event }.
 */
export async function POST(req: Request) {
  try {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let body: Partial<CreateLiveEventInput> = {};
    try {
      body = (await req.json()) as Partial<CreateLiveEventInput>;
    } catch {
      body = {};
    }
    const input: CreateLiveEventInput = {
      title: typeof body.title === "string" ? body.title : "",
      description: typeof body.description === "string" ? body.description : undefined,
      scheduledFor: typeof body.scheduledFor === "string" ? body.scheduledFor : "",
    };
    const { event } = await createEvent(sessionUser, input);
    return NextResponse.json({ event });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-events failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
