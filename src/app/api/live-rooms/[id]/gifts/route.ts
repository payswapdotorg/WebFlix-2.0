import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { giftFeed, sendGift } from "@/lib/live/gifts";
import type { SendGiftInput } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/gifts — send a gift (signed-in). Body
 * SendGiftInput (clientRequestId is the idempotency key). 200
 * `{ gift, duplicate?, match? }` — `duplicate: true` replays the committed
 * event (never a second row/publish); `match` is present when an ACTIVE
 * match with gift scoring accepted the send against the chosen team.
 * 403 gifts-disabled/not-live/banned/spend-cap; 404 invalid-gift; 429 per
 * RATE_LIMITS.gifts. The durable commit precedes the SSE fan-out (the
 * sandbox law).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    // Gate 1 of sendGift's frozen order (unauthenticated): the service
    // signature takes a non-null sender, so the route narrows first — the
    // answer shape (401 "unauthenticated") is identical either way.
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let body: SendGiftInput = {} as SendGiftInput;
    try {
      body = (await req.json()) as SendGiftInput;
    } catch {
      body = {} as SendGiftInput; // invalid JSON → validation errors below
    }
    const { gift, duplicate, match } = await sendGift(id, sessionUser, body);
    return NextResponse.json({
      gift,
      ...(duplicate ? { duplicate: true } : {}),
      ...(match ? { match } : {}),
    });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/gifts failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}

/**
 * GET /api/live-rooms/[id]/gifts?limit≤GIFT_FEED_MAX — the room's gift
 * feed (the room's durable history, newest first, resolved sender
 * handles). Public for public rooms (anonymous OK); limit clamped
 * 1..GIFT_FEED_MAX, default 20. 200 `{ gifts: GiftEventDto[] }`.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    const limitRaw = new URL(req.url).searchParams.get("limit");
    const limitParsed = limitRaw === null ? NaN : Number.parseInt(limitRaw, 10);
    const gifts = await giftFeed(
      id,
      sessionUser,
      Number.isInteger(limitParsed) ? limitParsed : undefined,
    );
    return NextResponse.json({ gifts });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-rooms/[id]/gifts failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
