import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import {
  deleteClubEmote,
  listClubEmotesForHost,
  saveClubEmote,
} from "@/lib/live/emotes";
import type { SaveLiveClubEmoteInput } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * WFX2-LIVE-PLATFORM-1 Phase 5-emotes (lane E-a) — the supporter-emote
 * routes (ADR-0011: non-monetary club identity — an emote is never
 * purchased, never a wallet item; no money surface exists behind any of
 * these routes).
 *
 * GET /api/live-clubs/emotes?hostId= — the room-host emote set with the
 *   CALLER'S entitlement stamped server-side. Anonymous callers welcome
 *   (honest entitled:false); a host with no club → clubName:null + empty
 *   list (NOT an error). 400 when hostId is missing.
 * POST /api/live-clubs/emotes — host-only upsert by code on the caller's
 *   OWN club: 201 create / 200 update; 404 no-club; 409 emote-set-full;
 *   rate-limited by RATE_LIMITS.emoteSave (429).
 * DELETE /api/live-clubs/emotes?code= — host-only, idempotent (absent
 *   code → still 200 { ok: true }).
 */
export async function GET(req: Request) {
  try {
    const hostId = new URL(req.url).searchParams.get("hostId") ?? "";
    if (!hostId) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    const sessionUser = await getSessionUser(req);
    const dto = await listClubEmotesForHost(hostId, sessionUser);
    return NextResponse.json(dto);
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-clubs/emotes failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  try {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let body: SaveLiveClubEmoteInput;
    try {
      body = (await req.json()) as SaveLiveClubEmoteInput;
    } catch {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    const result = await saveClubEmote(sessionUser, body);
    return NextResponse.json(result, { status: result.updated ? 200 : 201 });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-clubs/emotes failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  try {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const code = new URL(req.url).searchParams.get("code") ?? "";
    if (!code) {
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    }
    const result = await deleteClubEmote(sessionUser, code);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("DELETE /api/live-clubs/emotes failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
