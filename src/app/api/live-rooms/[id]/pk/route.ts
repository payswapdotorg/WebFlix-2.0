import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { cancelChallenge, currentBattle, openChallenge } from "@/lib/live/pk";
import type { CreateLivePkInput } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/live-rooms/[id]/pk — the room's battle view (the open challenge
 * it hosts, the active battle it fights, or the latest final/cancelled
 * one; the LAZY FINALIZE runs inside the read). Anonymous OK. 200
 * `{ battle: LivePkBattleDto | null }`; 404 unknown room.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const battle = await currentBattle(id);
    return NextResponse.json({ battle });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-rooms/[id]/pk failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}

/**
 * POST /api/live-rooms/[id]/pk — open a challenge (host-only; one open per
 * room → 409 challenge-open). Pairs the OLDEST other-host open challenge
 * when one waits (both flip active with a shared window). 200
 * `{ battle }`; 400; 403 host-only; 404; 409; 429 per RATE_LIMITS.pkManage.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let body: CreateLivePkInput = {};
    try {
      body = (await req.json()) as CreateLivePkInput;
    } catch {
      body = {}; // the default duration applies
    }
    const battle = await openChallenge(id, sessionUser, body);
    return NextResponse.json({ battle });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/pk failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}

/**
 * DELETE /api/live-rooms/[id]/pk — cancel the room's open/active challenge
 * (host-only). No winner, no snapshots (banked nothing); both rooms hear
 * it. 200 `{ battle }`; 403; 404 no-open-challenge; 429.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const battle = await cancelChallenge(id, sessionUser);
    return NextResponse.json({ battle });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("DELETE /api/live-rooms/[id]/pk failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
