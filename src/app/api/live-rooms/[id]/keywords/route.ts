import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import {
  addKeyword,
  listKeywords,
  removeKeyword,
  setBlockLinks,
} from "@/lib/live/keywords";

export const dynamic = "force-dynamic";

/**
 * GET /api/live-rooms/[id]/keywords — the staff-visible filter state
 * (blockLinks + the pattern list). Host/mod only — the filter is a
 * moderation tool, not a viewer surface. 200 `{ blockLinks, keywords }`;
 * 403; 404.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const keywords = await listKeywords(id, sessionUser);
    const room = await (await import("@/lib/live/permissions")).roomPolicyFor(id);
    return NextResponse.json({ blockLinks: room?.blockLinks ?? false, keywords });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-rooms/[id]/keywords failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}

/**
 * POST /api/live-rooms/[id]/keywords — add a blocked keyword (host/mod;
 * body `{ pattern }`, 1..KEYWORD_MAX=60, lowercased+trimmed; cap 50 per
 * room → 409 keyword-cap; a duplicate add is an idempotent success). The
 * audited keyword-add ledger row appends. 200 `{ keyword }`; 400; 403;
 * 404; 409; 429 per RATE_LIMITS.keywordManage.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let pattern = "";
    try {
      const body = (await req.json()) as { pattern?: unknown };
      if (typeof body.pattern === "string") pattern = body.pattern;
    } catch {
      pattern = ""; // validation answers below
    }
    const keyword = await addKeyword(id, sessionUser, pattern);
    return NextResponse.json({ keyword });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/keywords failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}

/**
 * PATCH /api/live-rooms/[id]/keywords — toggle the link-blocking policy
 * (host/mod; body `{ blockLinks: boolean }`; the audited ledger records the
 * intent). 200 `{ blockLinks }`; 403; 404; 429.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let enabled = false;
    let parsed = false;
    try {
      const body = (await req.json()) as { blockLinks?: unknown };
      if (typeof body.blockLinks === "boolean") {
        enabled = body.blockLinks;
        parsed = true;
      }
    } catch {
      parsed = false;
    }
    if (!parsed) {
      return NextResponse.json(
        { error: "invalid", message: "blockLinks must be a boolean" },
        { status: 400 },
      );
    }
    const result = await setBlockLinks(id, sessionUser, enabled);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("PATCH /api/live-rooms/[id]/keywords failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}

/**
 * DELETE /api/live-rooms/[id]/keywords?id= — remove a pattern (host/mod;
 * the audited keyword-remove ledger row appends). 200 `{ removed }`; 400
 * missing id; 403; 404 unknown pattern; 429.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const patternId = new URL(req.url).searchParams.get("id") ?? "";
    if (patternId.length === 0) {
      return NextResponse.json({ error: "invalid", message: "id required" }, { status: 400 });
    }
    const result = await removeKeyword(id, sessionUser, patternId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("DELETE /api/live-rooms/[id]/keywords failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
