/**
 * WFX2-W progress service — auto-saved watch progress (every 5s from the
 * player) + resume-on-load. The ViewEvent row (unique per user+video) is
 * the storage; `at` stays the view-dedupe anchor (never bumped by progress).
 */
import { db } from "@/lib/db";
import { notFound } from "./api";
import type { ProgressResultDto } from "./types";

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
    return { watchedSec, lastPositionSec };
  }
  const updated = await db.viewEvent.update({
    where: { id: existing.id },
    data: {
      watchedSec: Math.max(existing.watchedSec, watchedSec),
      lastPositionSec,
    },
  });
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
