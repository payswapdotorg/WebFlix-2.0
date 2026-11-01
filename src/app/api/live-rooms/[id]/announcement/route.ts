import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { setAnnouncement } from "@/lib/live/pins";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/announcement — set the room announcement
 * (host/moderator only; body `{ body }`, 1..ANNOUNCEMENT_BODY_MAX=280
 * chars). Persists on the room row and republishes the existing `room`
 * envelope (the room DTO already flows — the report's law, no new stream
 * kind). 200 `{ room }`; 400 invalid body; 403; 404; 429 per
 * RATE_LIMITS.announcementManage.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let body: unknown = undefined;
    try {
      const parsed = (await req.json()) as { body?: unknown };
      body = parsed.body;
    } catch {
      body = undefined; // validation answers below
    }
    const room = await setAnnouncement(id, sessionUser, typeof body === "string" ? body : null);
    return NextResponse.json({ room });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/announcement failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}

/**
 * DELETE /api/live-rooms/[id]/announcement — the host's clearing law
 * (nulling the columns; the room envelope republishes). 200 `{ room }`;
 * 403; 404; 429.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const room = await setAnnouncement(id, sessionUser, null);
    return NextResponse.json({ room });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("DELETE /api/live-rooms/[id]/announcement failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
