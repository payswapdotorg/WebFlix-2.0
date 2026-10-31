import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ensureShadowUser } from "@/lib/watch/local-comments";
import { RATE_LIMITS } from "@/lib/live/permissions";
import { isOpsBeaconKind, opsRateLimit, recordOpsEvent } from "@/lib/live/ops";
import type { LiveOpsBeaconDto } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/live/ops/beacon — the client media-observation intake
 * (ADR-0009, frozen contracts §3).
 *
 * Accepts ONLY the client-beaconable kinds; the server kinds
 * (rate_limit/provider_error/end_reconcile) are never client-claimable.
 * Requires a signed-in session (the shadow seam stamps actorId — anonymous
 * viewers are honestly not captured, never synthesized). Validates the
 * room exists and the supplied session belongs to it; clamps every field;
 * rate-limits through the capture path itself (a denied beacon is its own
 * `rate_limit` observation). Answers 200 { ok: true } — fire-and-forget on
 * the client, silent on any failure.
 */
export async function POST(req: Request) {
  try {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let body: Partial<LiveOpsBeaconDto> = {};
    try {
      body = (await req.json()) as Partial<LiveOpsBeaconDto>;
    } catch {
      body = {};
    }

    if (!isOpsBeaconKind(body.kind)) {
      return NextResponse.json(
        { error: "invalid", message: "unknown beacon kind" },
        { status: 422 },
      );
    }
    const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
    if (!roomId) {
      return NextResponse.json({ error: "invalid", message: "roomId required" }, { status: 422 });
    }
    const room = await db.liveRoom.findUnique({ where: { id: roomId }, select: { id: true } });
    if (!room) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    const sessionId =
      typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : null;
    if (sessionId) {
      const session = await db.liveSession.findUnique({
        where: { id: sessionId },
        select: { roomId: true },
      });
      if (!session || session.roomId !== roomId) {
        return NextResponse.json(
          { error: "invalid", message: "session does not belong to the room" },
          { status: 422 },
        );
      }
    }

    const identity = await ensureShadowUser(sessionUser);
    const limited = await opsRateLimit(
      "beacon",
      `wf:live:beacon:${roomId}:${identity.id}`,
      RATE_LIMITS.beacon,
    );
    if (!limited) {
      return NextResponse.json({ error: "rate-limited" }, { status: 429 });
    }

    const valueMs =
      typeof body.valueMs === "number" && Number.isFinite(body.valueMs)
        ? Math.max(0, Math.round(body.valueMs))
        : null;
    const code = typeof body.code === "string" ? body.code.trim().slice(0, 80) : null;

    // recordOpsEvent is best-effort by law and re-clamps everything.
    await recordOpsEvent({
      kind: body.kind,
      surface: "beacon",
      roomId,
      sessionId,
      actorId: identity.id,
      code,
      valueMs,
      meta: null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/live/ops/beacon failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
