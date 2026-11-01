import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { currentPin, pinMessage, unpinMessage } from "@/lib/live/pins";

export const dynamic = "force-dynamic";

/**
 * GET /api/live-rooms/[id]/pin — the room's current pinned message or
 * `null` (anonymous OK — the banner is a read-only room surface; the lazy
 * tombstone sweep runs here, so a dead pin never renders). 200
 * `{ pin: LivePinnedMessageDto | null }`; 404 unknown room.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const pin = await currentPin(id);
    return NextResponse.json({ pin });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-rooms/[id]/pin failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}

/**
 * POST /api/live-rooms/[id]/pin — pin a chat message (host/moderator only;
 * body `{ messageId }`). One pin per room by the unique law — pinning while
 * a pin exists REPLACES it (the row IS the pin). The append-only moderation
 * ledger records `pin`; the `pin` stream envelope fans out. 200
 * `{ pin }`; 400 invalid/tombstoned; 403; 404 unknown room/message; 429 per
 * RATE_LIMITS.pinManage.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let messageId = "";
    try {
      const body = (await req.json()) as { messageId?: unknown };
      if (typeof body.messageId === "string") messageId = body.messageId;
    } catch {
      messageId = ""; // validation answers below
    }
    const pin = await pinMessage(id, sessionUser, messageId);
    return NextResponse.json({ pin });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/pin failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}

/**
 * DELETE /api/live-rooms/[id]/pin — unpin (host/moderator only). Idempotent
 * success with no pin (the ledger records intent, like unmute/unban); the
 * null-pin envelope unmounts every attached banner. 200 `{ cleared }`;
 * 403; 404 unknown room; 429 per RATE_LIMITS.pinManage.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const result = await unpinMessage(id, sessionUser);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("DELETE /api/live-rooms/[id]/pin failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
