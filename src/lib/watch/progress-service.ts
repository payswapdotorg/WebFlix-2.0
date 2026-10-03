/**
 * WFX2-W progress service — auto-saved watch progress (every 5s from the
 * player) + resume-on-load. The ViewEvent row (unique per user+video) is
 * the storage; `at` stays the view-dedupe anchor (never bumped by progress).
 *
 * WFX2-P7-AN — saveProgress additionally upserts today's WatchDailyStat
 * (the daily watch-time aggregation). THE SINGLE WATCH-TIME SOURCE LAW:
 * only this autosave path writes WatchDailyStat — the increment is the
 * autosave's cumulative delta, max(0, watchedSec − existing.watchedSec).
 * The /api/view dedupe ping (6h-window semantics = view-dedupe, NOT
 * watch-time) never touches the daily table.
 */
import { db } from "@/lib/db";
import { notFound } from "./api";
import type { ProgressResultDto } from "./types";

/** "YYYY-MM-DD" UTC date key for a WatchDailyStat row. */
export function utcDayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Upsert today's daily stat row: sec += delta; videosWatched +1 only on a
 * first watch (the ViewEvent creation the caller just performed).
 */
async function addDailyDelta(
  userId: string,
  deltaSec: number,
  firstWatch: boolean
): Promise<void> {
  const day = utcDayKey();
  await db.watchDailyStat.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, sec: deltaSec, videosWatched: firstWatch ? 1 : 0 },
    update: {
      sec: { increment: deltaSec },
      ...(firstWatch ? { videosWatched: { increment: 1 } } : {}),
    },
  });
}

export async function saveProgress(
  videoId: string,
  userId: string,
  watchedSec: number,
  lastPositionSec: number
): Promise<ProgressResultDto> {
  const video = await db.video.findUnique({ where: { id: videoId }, select: { id: true } });
  if (!video) throw notFound("Video");

  const existing = await db.viewEvent.findUnique({
    where: { videoId_userId: { videoId, userId } },
  });
  if (!existing) {
    await db.viewEvent.create({
      data: { videoId, userId, watchedSec, lastPositionSec },
    });
    // first watch of this video for this viewer: the full autosave amount
    // lands on today's row and the video count increments
    await addDailyDelta(userId, Math.max(0, watchedSec), true);
    return { watchedSec, lastPositionSec };
  }
  const updated = await db.viewEvent.update({
    where: { id: existing.id },
    data: {
      watchedSec: Math.max(existing.watchedSec, watchedSec),
      lastPositionSec,
    },
  });
  // the delta is exactly how much the lifetime max grew this save (never
  // negative — a re-watch from the start does not un-watch earlier time)
  const delta = Math.max(0, watchedSec - existing.watchedSec);
  if (delta > 0) {
    await addDailyDelta(userId, delta, false);
  }
  return { watchedSec: updated.watchedSec, lastPositionSec: updated.lastPositionSec };
}

/** Resume position for the viewer (null when no history). */
export async function getResume(videoId: string, userId: string): Promise<number | null> {
  const event = await db.viewEvent.findUnique({
    where: { videoId_userId: { videoId, userId } },
    select: { lastPositionSec: true },
  });
  return event?.lastPositionSec ?? null;
}
