/**
 * P100-TIKTOK-LIVE — /api/tiktok/live/chat/[room]: the watch-party chat
 * route. Guests READ freely; sending/deleting ride the session (401 with
 * the client rendering the INLINE gate — never a hard /signin eject).
 * The room param rides the G20 law (sigil soup normalizes, garbage 400s).
 */
import { NextRequest, NextResponse } from "next/server";
import { authRequiredResponse, getSessionUser } from "@/lib/auth/session";
import { rateLimit } from "@/lib/youtube/cache";
import {
  deleteOwnTikTokLiveChatMessage,
  listTikTokLiveChatMessages,
  normalizeTikTokLiveRoomKey,
  sendTikTokLiveChatMessage,
  TIKTOK_LIVE_CHAT_RATE,
  TikTokLiveChatError,
} from "@/lib/tiktok/live-chat";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ room: string }> };

function errorResponse(err: unknown): NextResponse {
  if (err instanceof TikTokLiveChatError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("tiktok live chat route failed", err);
  return NextResponse.json({ error: "The watch-party chat is unavailable right now." }, { status: 502 });
}

export async function GET(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  try {
    const { room } = await ctx.params;
    const after = req.nextUrl.searchParams.get("after");
    const limitRaw = req.nextUrl.searchParams.get("limit");
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    const page = await listTikTokLiveChatMessages(room, { after, limit });
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return authRequiredResponse();
  // the per-sender burst cap (the request-layer owns the limiter — the
  // channels.ts law: the request layer owns the DB/infra reads)
  const allowed = await rateLimit(`tiktok-live-chat:${sessionUser.id}`, TIKTOK_LIVE_CHAT_RATE);
  if (!allowed) {
    return NextResponse.json(
      { error: "You are sending messages too quickly — take a breath." },
      { status: 429 }
    );
  }
  try {
    const { room } = await ctx.params;
    let payload: { clientMessageId?: unknown; body?: unknown } = {};
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const message = await sendTikTokLiveChatMessage(
      sessionUser,
      room,
      typeof payload.clientMessageId === "string" ? payload.clientMessageId : "",
      typeof payload.body === "string" ? payload.body : ""
    );
    return NextResponse.json({ message }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return authRequiredResponse();
  try {
    const { room } = await ctx.params;
    normalizeTikTokLiveRoomKey(room); // an invalid room is a 400 even here
    const messageId = req.nextUrl.searchParams.get("messageId") ?? "";
    const done = await deleteOwnTikTokLiveChatMessage(sessionUser, room, messageId);
    if (!done) {
      return NextResponse.json({ error: "Message not found." }, { status: 404 });
    }
    return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
