import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { fetchChannelVideos, fetchOperatorChannel, fetchVideoComments, mainPost } from "@/lib/main-api";
import { byPublishedDesc } from "@/lib/mapping";
import { commentActionPath } from "@/lib/comments";
import { rateLimit } from "@/lib/ratelimit";
import type { NormalizedComment } from "@/lib/types";

export const runtime = "nodejs";

const ActionBody = z.object({
  commentId: z.string().min(1),
  action: z.enum(["approve", "delete", "heart"]),
});

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, degraded: true, status: 401, reason: "sign-in required", comments: [] }, { status: 401 });
  const rl = rateLimit(`studio:comments:${session.email}`, 120, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false, degraded: true, status: 429, reason: "rate limited", comments: [] }, { status: 429 });

  const ch = await fetchOperatorChannel();
  if (!ch.ok) return NextResponse.json({ ok: false, degraded: true, status: ch.status, reason: ch.reason, comments: [] });

  const tabs = await Promise.all([
    fetchChannelVideos(ch.data.handle, "videos"),
    fetchChannelVideos(ch.data.handle, "shorts"),
    fetchChannelVideos(ch.data.handle, "live"),
  ]);
  const videoIds: string[] = [];
  const titleById = new Map<string, string>();
  for (const t of tabs) if (t.ok) for (const v of [...t.data].sort(byPublishedDesc)) { videoIds.push(v.id); titleById.set(v.id, v.title); }
  const targets = videoIds.slice(0, 10);

  const results = await Promise.all(targets.map((id) => fetchVideoComments(id)));
  const okResults = results.filter((r): r is Extract<typeof r, { ok: true }> => r.ok);
  const allDegraded = targets.length > 0 && okResults.length === 0;

  const comments: NormalizedComment[] = okResults
    .flatMap((r) => r.data)
    .map((c) => ({ ...c, videoTitle: c.videoId ? titleById.get(c.videoId) ?? null : null }))
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));

  return NextResponse.json({
    ok: true,
    degraded: allDegraded,
    reason: allDegraded ? "Comment broker offline — comments unavailable (honest degrade)." : null,
    skipped: targets.length - okResults.length,
    comments,
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, degraded: true, status: 401, reason: "sign-in required" }, { status: 401 });
  const rl = rateLimit(`studio:comment-action:${session.email}`, 30, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false, degraded: true, status: 429, reason: "rate limited" }, { status: 429 });

  const parsed = ActionBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, degraded: true, status: 400, reason: "invalid action payload" }, { status: 400 });

  const upstream = await mainPost(commentActionPath(parsed.data.commentId, parsed.data.action));
  if (!upstream.ok) {
    // Honest 502-degrade: broker offline / kind missing — the action is NOT applied.
    return NextResponse.json(
      { ok: false, degraded: true, status: upstream.status, reason: "Comment broker unavailable — action not applied." },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true });
}
