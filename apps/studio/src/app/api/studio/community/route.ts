import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { fetchCommunityPosts, fetchOperatorChannel } from "@/lib/main-api";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, degraded: true, status: 401, reason: "sign-in required", posts: [], channel: null }, { status: 401 });
  const rl = rateLimit(`studio:community:${session.email}`, 120, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false, degraded: true, status: 429, reason: "rate limited", posts: [], channel: null }, { status: 429 });

  const ch = await fetchOperatorChannel();
  if (!ch.ok) return NextResponse.json({ ok: false, degraded: true, status: ch.status, reason: ch.reason, posts: [], channel: null });

  const posts = await fetchCommunityPosts(ch.data.handle);
  return NextResponse.json({ ok: true, degraded: posts.degraded, reason: posts.reason, posts: posts.posts, channel: ch.data });
}
