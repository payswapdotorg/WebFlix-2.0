import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { createReport, listReports } from "@/lib/live/moderation";
import type { CreateLiveReportInput } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/reports — file a report. Any signed-in user;
 * body CreateLiveReportInput; 429 per RATE_LIMITS.reports.
 * 200 { report: LiveReportDto } (status "open").
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let body: CreateLiveReportInput = {} as CreateLiveReportInput;
    try {
      body = (await req.json()) as CreateLiveReportInput;
    } catch {
      body = {} as CreateLiveReportInput;
    }
    const { report } = await createReport(id, sessionUser, body);
    return NextResponse.json({ report });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/reports failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}

/**
 * GET /api/live-rooms/[id]/reports?limit≤100 — the room's report queue.
 * HOST only, newest first; other rooms' reports never leak.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const rawLimit = new URL(req.url).searchParams.get("limit");
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    const { reports } = await listReports(id, sessionUser, { limit });
    return NextResponse.json({ reports });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-rooms/[id]/reports failed", err);
    return NextResponse.json({ error: "provider-failed" }, { status: 502 });
  }
}
