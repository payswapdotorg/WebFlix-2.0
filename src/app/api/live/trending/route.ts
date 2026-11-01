import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { trendingRooms } from "@/lib/live/rooms";

export const dynamic = "force-dynamic";

/**
 * GET /api/live/trending — the discovery shelf's derivation (Parity P73-2,
 * ADR-0012): engagement over the last TRENDING_WINDOW_MS (24h) of durable
 * rows (Σ reaction counts + Σ gift credits + non-tombstoned chat count) per
 * LIVE public room, top TRENDING_MAX (6), ZERO-ENGAGEMENT ROOMS EXCLUDED
 * (the honest empty state). Reuses the room DTOs verbatim; anonymous OK.
 * 200 `{ rooms, windowMs }`.
 */
export async function GET(req: Request) {
  try {
    const sessionUser = await getSessionUser(req);
    const { rooms, windowMs } = await trendingRooms(sessionUser);
    return NextResponse.json({ rooms, windowMs });
  } catch (err) {
    console.error("GET /api/live/trending failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
