import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { fetchChannelVideos, fetchOperatorChannel } from "@/lib/main-api";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, degraded: true, status: 401, reason: "sign-in required", videos: [], channel: null }, { status: 401 });
  const rl = rateLimit(`studio:videos:${session.email}`, 120, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false, degraded: true, status: 429, reason: "rate limited", videos: [], channel: null }, { status: 429 });

  const params = new URL(req.url).searchParams;
  const tabParam = params.get("tab") ?? "videos";
  const tab = tabParam === "shorts" || tabParam === "live" ? tabParam : "videos";
  const limit = Math.min(Number(params.get("limit") ?? 100) || 100, 200);

  const ch = await fetchOperatorChannel();
  if (!ch.ok) return NextResponse.json({ ok: false, degraded: true, status: ch.status, reason: ch.reason, videos: [], channel: null });

  const vids = await fetchChannelVideos(ch.data.handle, tab);
  if (!vids.ok) return NextResponse.json({ ok: false, degraded: true, status: vids.status, reason: vids.reason, videos: [], channel: ch.data });

  return NextResponse.json({ ok: true, degraded: false, videos: vids.data.slice(0, limit), channel: ch.data });
}
