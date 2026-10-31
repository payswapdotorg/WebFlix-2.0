import { NextResponse } from "next/server";
import { listPublicReplays } from "@/lib/live/replays";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * GET /api/live/replays — the discovery replay shelf (public; anonymous
 * OK): the newest REPLAY_LIST_MAX ready replays on public rooms with
 * public/inherit visibility, resolved host handles. 200
 * `{ replays: LiveReplaySummaryDto[] }`.
 */
export async function GET() {
  try {
    const replays = await listPublicReplays();
    return NextResponse.json({ replays });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live/replays failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
