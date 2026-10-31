import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { askQuestion, listQuestions } from "@/lib/live/questions";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import type { CreateLiveQuestionInput } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/live-rooms/[id]/questions — the public list (non-hidden, newest
 * first; default 30, max 50). `?includeHidden` is honored only for
 * host+moderators; anonymous reads are allowed.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    const url = new URL(req.url);
    const includeHiddenParam = url.searchParams.get("includeHidden");
    const includeHidden = includeHiddenParam === "1" || includeHiddenParam === "true";
    const limitRaw = url.searchParams.get("limit");
    const parsedLimit = limitRaw === null ? Number.NaN : Number(limitRaw);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;
    const { questions } = await listQuestions(id, sessionUser, { includeHidden, limit });
    return NextResponse.json({ questions });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-rooms/[id]/questions failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}

/**
 * POST /api/live-rooms/[id]/questions — any signed-in viewer asks (banned
 * and muted cannot: asking is speech). Body `CreateLiveQuestionInput`.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let body: Partial<CreateLiveQuestionInput> = {};
    try {
      body = (await req.json()) as Partial<CreateLiveQuestionInput>;
    } catch {
      body = {};
    }
    const input: CreateLiveQuestionInput = {
      body: typeof body.body === "string" ? body.body : "",
    };
    const { question } = await askQuestion(id, sessionUser, input);
    return NextResponse.json({ question });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/questions failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
