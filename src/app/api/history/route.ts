import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUser } from "@/lib/session";
import { toContinueVideoDTO } from "@/lib/dto";
import { historyGroupLabel } from "@/lib/format";
import type { ContinueVideoDTO, HistoryGroupDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/history — view events, latest-per-video, grouped by day. */
export async function GET() {
  try {
    const user = await getDemoUser();
    const events = await db.viewEvent.findMany({
      where: { userId: user.id },
      include: { video: { include: { channel: true } } },
      orderBy: { at: "desc" },
    });
    const latestPerVideo = new Map<string, ContinueVideoDTO>();
    for (const e of events) {
      if (latestPerVideo.has(e.videoId)) continue;
      latestPerVideo.set(
        e.videoId,
        toContinueVideoDTO(e.video, e.watchedSec, e.at)
      );
    }
    const items = [...latestPerVideo.values()];
    const groups = new Map<string, ContinueVideoDTO[]>();
    for (const item of items) {
      const label = historyGroupLabel(item.watchedAt);
      const list = groups.get(label) ?? [];
      list.push(item);
      groups.set(label, list);
    }
    const data: HistoryGroupDTO[] = [...groups.entries()].map(([label, list]) => ({
      label,
      items: list,
    }));
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/history failed", err);
    return NextResponse.json({ error: "Failed to load history" }, { status: 500 });
  }
}

/** DELETE /api/history — clear all watch history for the demo user. */
export async function DELETE() {
  try {
    const user = await getDemoUser();
    const result = await db.viewEvent.deleteMany({ where: { userId: user.id } });
    return NextResponse.json({ deleted: result.count });
  } catch (err) {
    console.error("DELETE /api/history failed", err);
    return NextResponse.json({ error: "Failed to clear history" }, { status: 500 });
  }
}
