import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { fetchOperatorChannel } from "@/lib/main-api";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, degraded: true, status: 401, reason: "sign-in required", channel: null }, { status: 401 });
  const rl = rateLimit(`studio:channel:${session.email}`, 120, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false, degraded: true, status: 429, reason: "rate limited", channel: null }, { status: 429 });

  const res = await fetchOperatorChannel();
  if (!res.ok) return NextResponse.json({ ...res, channel: null });
  return NextResponse.json({ ok: true, degraded: false, channel: res.data });
}
