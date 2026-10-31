import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getReplayFor, setReplayVisibility } from "@/lib/live/replays";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * GET /api/live-rooms/[id]/replay — visibility-checked read (public rooms
 * serve everyone; unlisted rooms serve link holders; hidden replays are
 * host-only). 200 `{ asset, playbackUrl }` — the playback URL is minted
 * at read time and carries no key; 404 when the room/asset is missing or
 * the visibility law denies (existence never disclosed). The lazy
 * retention sweep runs inside the domain read.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    const found = await getReplayFor(id, sessionUser);
    if (!found) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    return NextResponse.json({ asset: found.asset, playbackUrl: found.playbackUrl });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-rooms/[id]/replay failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}

/**
 * PATCH /api/live-rooms/[id]/replay — host only; body
 * `{ visibility: "inherit" | "public" | "unlisted" | "hidden" }`. 200
 * `{ asset }`; 429 replayVisibility.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let body: { visibility?: unknown } = {};
    try {
      body = (await req.json()) as { visibility?: unknown };
    } catch {
      body = {}; // absent/invalid JSON → the domain validation answers
    }
    const asset = await setReplayVisibility(id, sessionUser, body.visibility);
    return NextResponse.json({ asset });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("PATCH /api/live-rooms/[id]/replay failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
