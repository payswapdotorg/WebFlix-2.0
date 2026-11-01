import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { LiveDomainError, liveErrorStatus } from "@/lib/live/rooms";
import { closeGoal, createGoal, listGoals } from "@/lib/live/goals";
import type { CreateLiveGoalInput } from "@/lib/live/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/live-rooms/[id]/goals — the host opens the room's LIVE goal
 * (host-only; one open goal per room is the domain law — a second open is
 * a 409 `goal-open`). Body CreateLiveGoalInput { kind, target, title? }.
 * 201 `{ goal }`; 400 invalid kind/target/title; 403 host-only; 409
 * goal-open; 429 per RATE_LIMITS.goalManage.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    let body: CreateLiveGoalInput = {} as CreateLiveGoalInput;
    try {
      body = (await req.json()) as CreateLiveGoalInput;
    } catch {
      body = {} as CreateLiveGoalInput;
    }
    const goal = await createGoal(id, sessionUser, body);
    return NextResponse.json({ goal }, { status: 201 });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("POST /api/live-rooms/[id]/goals failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}

/**
 * GET /api/live-rooms/[id]/goals — the room's goal history, newest first
 * (GOAL_LIST_MAX cap), every open goal's progress DERIVED server-side on
 * the way out (the lazy reach flip runs here too). Anonymous OK — the goal
 * is a read-only room surface. 200 `{ goals: LiveGoalDto[] }`; 404 unknown
 * room.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const goals = await listGoals(id);
    return NextResponse.json({ goals });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("GET /api/live-rooms/[id]/goals failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}

/**
 * DELETE /api/live-rooms/[id]/goals — the host closes a goal (body/query
 * `goalId`; host-only). A closed goal is terminal — the room may start the
 * next one after. 200 `{ goal }`; 403 host-only; 404 unknown goal; 409
 * already-closed; 429 per RATE_LIMITS.goalManage.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    const url = new URL(req.url);
    let goalId = url.searchParams.get("goalId") ?? "";
    if (!goalId) {
      try {
        const body = (await req.json()) as { goalId?: unknown };
        if (typeof body.goalId === "string") goalId = body.goalId;
      } catch {
        // no body — the query param was the only chance
      }
    }
    if (goalId.length === 0) {
      return NextResponse.json({ error: "invalid", message: "goalId required" }, { status: 400 });
    }
    const goal = await closeGoal(id, sessionUser, goalId);
    return NextResponse.json({ goal });
  } catch (err) {
    if (err instanceof LiveDomainError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: liveErrorStatus(err.code) },
      );
    }
    console.error("DELETE /api/live-rooms/[id]/goals failed", err);
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
}
