import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { fetchChannelVideos, fetchOperatorChannel } from "@/lib/main-api";
import { dailySeries, filterByRange, isRangeKey, topVideos, totals, type RangeKey } from "@/lib/analytics";
import { rateLimit } from "@/lib/ratelimit";
import type { NormalizedVideo } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, degraded: true, status: 401, reason: "sign-in required", series: [], totals: null, topVideos: [], subscriberCount: null }, { status: 401 });
  const rl = rateLimit(`studio:analytics:${session.email}`, 120, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false, degraded: true, status: 429, reason: "rate limited", series: [], totals: null, topVideos: [], subscriberCount: null }, { status: 429 });

  const ch = await fetchOperatorChannel();
  if (!ch.ok) return NextResponse.json({ ok: false, degraded: true, status: ch.status, reason: ch.reason, series: [], totals: null, topVideos: [], subscriberCount: null });

  const results = await Promise.all([
    fetchChannelVideos(ch.data.handle, "videos"),
    fetchChannelVideos(ch.data.handle, "shorts"),
    fetchChannelVideos(ch.data.handle, "live"),
  ]);
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok) {
    return NextResponse.json({ ok: false, degraded: true, status: failed.status, reason: failed.reason, series: [], totals: null, topVideos: [], subscriberCount: ch.data.subscriberCount });
  }

  const byId = new Map<string, NormalizedVideo>();
  for (const r of results) if (r.ok) for (const v of r.data) byId.set(v.id, v);
  const all = [...byId.values()];

  const rangeParam = new URL(req.url).searchParams.get("range") ?? "28";
  const range: RangeKey = isRangeKey(rangeParam) ? rangeParam : "28";
  const inRange = filterByRange(all, range);

  return NextResponse.json({
    ok: true,
    degraded: false,
    range,
    series: dailySeries(inRange, range),
    totals: totals(inRange),
    topVideos: topVideos(inRange, 10),
    subscriberCount: ch.data.subscriberCount,
  });
}
