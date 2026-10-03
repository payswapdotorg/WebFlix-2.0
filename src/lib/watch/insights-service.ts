/**
 * WFX2-P7-AN — watch insights service. The real aggregation over the rows
 * the app genuinely records (ViewEvent + WatchDailyStat). NEVER FABRICATE:
 * zero-filled days are real zeros (days the viewer watched nothing), there
 * is no backfill, no interpolation, no synthetic history — the series is
 * honestly empty before the feature landed.
 */
import { db } from "@/lib/db";
import type {
  InsightsDto,
  InsightsTopVideoDto,
  InsightsTotalsDto,
  SeriesPointDto,
} from "./types";

/** UTC day key "YYYY-MM-DD" → the day n days before it (UTC arithmetic). */
function dayKeyMinus(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * The viewer's watch insights: totals, the zero-filled 28-day UTC series,
 * and the top videos by lifetime watchedSec.
 */
export async function getWatchInsights(userId: string): Promise<InsightsDto> {
  const todayKey = new Date().toISOString().slice(0, 10);

  const [viewAgg, viewCount, activeRows, topEvents] = await Promise.all([
    db.viewEvent.aggregate({
      where: { userId },
      _sum: { watchedSec: true },
    }),
    db.viewEvent.count({ where: { userId } }),
    db.watchDailyStat.findMany({
      where: { userId, sec: { gt: 0 } },
      select: { day: true, sec: true },
      orderBy: { day: "desc" },
    }),
    db.viewEvent.findMany({
      where: { userId },
      orderBy: { watchedSec: "desc" },
      take: 10,
      select: {
        videoId: true,
        watchedSec: true,
        at: true,
        video: {
          select: {
            id: true,
            title: true,
            thumbnailUrl: true,
            channel: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  // streak: consecutive active days (sec>0) ending today or yesterday (UTC)
  const activeSet = new Set(activeRows.map((r) => r.day));
  let streakDays = 0;
  let cursor = activeSet.has(todayKey)
    ? todayKey
    : activeSet.has(dayKeyMinus(todayKey, 1))
      ? dayKeyMinus(todayKey, 1)
      : null;
  while (cursor !== null && activeSet.has(cursor)) {
    streakDays++;
    cursor = dayKeyMinus(cursor, 1);
  }

  const watchedSecAllTime = viewAgg._sum.watchedSec ?? 0;
  const activeDays = activeRows.length;
  const totals: InsightsTotalsDto = {
    watchedSecAllTime,
    videosWatched: viewCount,
    activeDays,
    avgSecPerActiveDay: activeDays > 0 ? Math.round(watchedSecAllTime / activeDays) : 0,
    streakDays,
  };

  // the 28-day series, oldest first, gap days zero-filled (real zeros)
  const byDay = new Map(activeRows.map((r) => [r.day, r.sec] as const));
  const series28d: SeriesPointDto[] = [];
  for (let i = 27; i >= 0; i--) {
    const day = dayKeyMinus(todayKey, i);
    series28d.push({ day, sec: byDay.get(day) ?? 0 });
  }

  // top videos: a ViewEvent whose Video row is gone is skipped (defensive —
  // the FK cascade makes it rare, but the insights never render a ghost)
  const topVideos: InsightsTopVideoDto[] = topEvents
    .filter((e) => e.video !== null)
    .map((e) => ({
      videoId: e.videoId,
      title: e.video!.title,
      channelName: e.video!.channel.name,
      thumbnailUrl: e.video!.thumbnailUrl,
      watchedSec: e.watchedSec,
      lastWatchedAt: e.at.toISOString(),
    }));

  return { totals, series28d, topVideos };
}

/**
 * The watched map — {videoId: watchedSec} for the ids the caller batches
 * (one POST, never a per-card fetch). Ids with no ViewEvent row are absent.
 */
export async function getWatchedMap(
  userId: string,
  videoIds: string[]
): Promise<Record<string, number>> {
  if (videoIds.length === 0) return {};
  const rows = await db.viewEvent.findMany({
    where: { userId, videoId: { in: videoIds } },
    select: { videoId: true, watchedSec: true },
  });
  const map: Record<string, number> = {};
  for (const r of rows) map[r.videoId] = r.watchedSec;
  return map;
}
