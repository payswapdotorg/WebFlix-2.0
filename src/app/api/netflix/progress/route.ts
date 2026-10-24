import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/youtube/cache";
import { netflixViewerId } from "@/lib/netflix/viewer";
import {
  CONTINUE_WATCHING_CAP,
  listContinueWatching,
  recordWatch,
  removeWatch,
} from "@/lib/netflix/progress";

export const dynamic = "force-dynamic";

/**
 * Continue Watching (P49) — the viewer's WebFlix-LOCAL Netflix play memory
 * (ADR 0002 §5 — no Netflix credentials anywhere; the memory is honest-local,
 * exactly like My List). Identity = netflixViewerId (the signed-in WebFlix
 * account first via its shadow user, then the watch-lane demo fallback).
 *
 * GET              → { items: { title, lastPlayedAt, playCount }[], source: "netflix-progress" }
 *                    (anonymous reads answer honest-empty — never a fake row)
 * POST {netflixId} → { recorded: true }   (401 anonymous, 400 malformed, 404
 *                    when the id is outside the tracked Top-10 universe)
 * DELETE ?netflixId= → { recorded: false } (the rail's remove affordance)
 */
export async function GET(req: Request) {
  try {
    if (!(await rateLimit(`netflix:progress:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const viewerId = await netflixViewerId(req);
    if (!viewerId) {
      return NextResponse.json({ items: [], source: "netflix-progress" });
    }
    const items = await listContinueWatching(viewerId, CONTINUE_WATCHING_CAP);
    return NextResponse.json({ items, source: "netflix-progress" });
  } catch (err) {
    console.error("GET /api/netflix/progress failed", err);
    return NextResponse.json({ error: "Failed to load Continue Watching" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  try {
    if (!(await rateLimit(`netflix:progress:post:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const viewerId = await netflixViewerId(req);
    if (!viewerId) {
      return NextResponse.json({ error: "Sign in to keep your Continue Watching row" }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as { netflixId?: unknown };
    const netflixId = Number(body.netflixId);
    if (!Number.isInteger(netflixId) || netflixId <= 0) {
      return NextResponse.json({ error: "netflixId required" }, { status: 400 });
    }
    await recordWatch(viewerId, netflixId);
    return NextResponse.json({ recorded: true });
  } catch (err) {
    if (err instanceof Error && err.message === "title-not-in-catalog") {
      return NextResponse.json({ error: "Title not in the tracked Netflix catalog" }, { status: 404 });
    }
    console.error("POST /api/netflix/progress failed", err);
    return NextResponse.json({ error: "Failed to record the play" }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  try {
    if (!(await rateLimit(`netflix:progress:del:${req.headers.get("x-forwarded-for") ?? "local"}`))) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }
    const viewerId = await netflixViewerId(req);
    if (!viewerId) {
      return NextResponse.json({ error: "Sign in to manage your Continue Watching row" }, { status: 401 });
    }
    const netflixId = Number(new URL(req.url).searchParams.get("netflixId"));
    if (!Number.isInteger(netflixId) || netflixId <= 0) {
      return NextResponse.json({ error: "netflixId required" }, { status: 400 });
    }
    await removeWatch(viewerId, netflixId);
    return NextResponse.json({ recorded: false });
  } catch (err) {
    console.error("DELETE /api/netflix/progress failed", err);
    return NextResponse.json({ error: "Failed to remove the title" }, { status: 502 });
  }
}
