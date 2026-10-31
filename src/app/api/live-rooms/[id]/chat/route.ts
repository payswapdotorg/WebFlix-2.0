import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { listChat, sendChat } from "@/lib/live/chat";
import type { SendLiveChatInput } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/chat — send a chat message / announcement.
 * Body SendLiveChatInput (clientMessageId is the idempotency key); 200
 * `{ message, duplicate? }`; the honest 403/429 contract comes from the
 * domain gates (muted/banned/chat-disabled/slow-mode/not-live/rate-limited).
 * A duplicate clientMessageId returns the ORIGINAL message with
 * `duplicate: true` — idempotent success, never a second row.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    let body: SendLiveChatInput = {} as SendLiveChatInput;
    try {
      body = (await req.json()) as SendLiveChatInput;
    } catch {
      body = {} as SendLiveChatInput; // invalid JSON → validation errors below
    }
    const { message, duplicate } = await sendChat(id, sessionUser, body);
    return NextResponse.json(duplicate ? { message, duplicate: true } : { message });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/chat failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}

/**
 * GET /api/live-rooms/[id]/chat?after=<seq>&limit≤100 — durable replay,
 * ordered by seq asc (strictly after `after`), tombstoned rows included
 * (deleted: true, body: ""). Readable anonymously for public rooms.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const afterRaw = url.searchParams.get("after");
    const limitRaw = url.searchParams.get("limit");
    const afterParsed = afterRaw === null ? NaN : Number.parseInt(afterRaw, 10);
    const limitParsed = limitRaw === null ? NaN : Number.parseInt(limitRaw, 10);
    const messages = await listChat(id, {
      after: Number.isInteger(afterParsed) ? afterParsed : undefined,
      limit: Number.isInteger(limitParsed) ? limitParsed : undefined,
    });
    return NextResponse.json({ messages });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-rooms/[id]/chat failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
