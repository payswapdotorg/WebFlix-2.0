import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { fetchOperatorChannel, mainPost } from "@/lib/main-api";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

const Body = z.object({
  handle: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, degraded: true, status: 401, reason: "sign-in required" }, { status: 401 });
  const rl = rateLimit(`studio:customization:${session.email}`, 30, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false, degraded: true, status: 429, reason: "rate limited" }, { status: 429 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, degraded: true, status: 400, reason: "invalid payload" }, { status: 400 });

  const res = await mainPost(`/api/channel/${encodeURIComponent(parsed.data.handle)}`, {
    title: parsed.data.title,
    description: parsed.data.description,
  });
  if (!res.ok) {
    // Honest degrade — no broker write kind for channel metadata yet.
    return NextResponse.json({
      ok: false,
      degraded: true,
      status: res.status,
      reason: "Saving is available on the main app — WebFlix Studio edits stay read-only until a broker write kind exists.",
    });
  }
  return NextResponse.json({ ok: true });
}
