import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { createClub, getMyClub } from "@/lib/live/clubs";
import type { CreateLiveFanClubInput } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * WFX2-LIVE-PLATFORM-1 Phase 5 (lane 5-a) — non-monetary fan clubs
 * (ADR-0010: points/levels are ENTERTAINMENT facts; no money surface exists
 * behind any of these routes).
 *
 * POST /api/live-clubs — create the caller's club (signed-in creators only;
 * one club per creator → 409 on a second create; name/motto clamped
 * server-side; rate-limited by RATE_LIMITS.clubCreate). 201 `{ club }`.
 * GET /api/live-clubs — the caller's OWN club (`{ club }` or
 * `{ club: null }`; anonymous → 401). This is the same surface as the
 * frozen `GET /api/live-clubs/mine` route (see mine/route.ts).
 */
export async function POST(req: Request) {
  try {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let body: CreateLiveFanClubInput;
    try {
      body = (await req.json()) as CreateLiveFanClubInput;
    } catch {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    const club = await createClub(sessionUser, body);
    return NextResponse.json({ club }, { status: 201 });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-clubs failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}

export async function GET(req: Request) {
  try {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const club = await getMyClub(sessionUser);
    return NextResponse.json({ club });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-clubs failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
