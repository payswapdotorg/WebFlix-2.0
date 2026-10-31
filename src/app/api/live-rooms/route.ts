import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/youtube/cache";
import { createRoom, listRooms, LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import type { CreateLiveRoomInput } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * WFX2-LIVE-PLATFORM-1 — first-party LIVE discovery + room creation.
 *
 * GET /api/live-rooms?status=live — public WebFlix-owned rooms with fresh
 * approximate viewer counts (the YouTube discovery stays /api/live).
 * POST /api/live-rooms — create a room (any signed-in user); the room starts
 * "idle" and only the host's session start flips it live.
 */
export async function GET(req: Request) {
  try {
    if (!(await rateLimit(`live-rooms:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "rate-limited" }, { status: 429 });
    }
    const statusParam = new URL(req.url).searchParams.get("status");
    const status = statusParam === "ended" ? "ended" : statusParam === "idle" ? "idle" : "live";
    const sessionUser = await getSessionUser(req);
    const rooms = await listRooms({ status, sessionUser: sessionUser });
    return NextResponse.json({ rooms });
  } catch (err) {
    console.error("GET /api/live-rooms failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  try {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let body: CreateLiveRoomInput;
    try {
      body = (await req.json()) as CreateLiveRoomInput;
    } catch {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    const room = await createRoom(sessionUser, body);
    return NextResponse.json({ room }, { status: 201 });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json({ error: err.code }, { status: liveErrorStatus(err.code) });
    }
    console.error("POST /api/live-rooms failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
