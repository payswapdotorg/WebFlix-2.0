import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { stopReplay } from "@/lib/live/replays";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/replay/stop — the host-capture finalize.
 * NOT JSON: the raw webm/mp4 take rides the body; `Content-Type` must be
 * in REPLAY_MIME_TYPES; the recorder-reported media duration rides the
 * `?durationMs=` query (rejected, never clamped, when impossible). 200
 * `{ asset }` (status `ready`); 400 invalid (empty-recording /
 * unsupported-media-type / recording-too-large / invalid-duration); 403
 * forbidden / "not-live"; 409 "replay-not-recording"; 429 replayStop.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const body = await req.arrayBuffer();
    const contentType = req.headers.get("content-type");
    const rawDuration = new URL(req.url).searchParams.get("durationMs");
    let durationMs: number | null = null;
    if (rawDuration !== null) {
      const parsed = Number(rawDuration);
      durationMs = Number.isFinite(parsed) ? parsed : null;
    }
    const asset = await stopReplay(id, sessionUser, { body, contentType, durationMs });
    return NextResponse.json({ asset });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/replay/stop failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
