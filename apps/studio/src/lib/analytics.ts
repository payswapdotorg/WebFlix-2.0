import type { NormalizedVideo, SeriesPoint, Totals } from "./types";

export type RangeKey = "28" | "90" | "365" | "lifetime";
export const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: "28", label: "Last 28 days", days: 28 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "365", label: "Last 365 days", days: 365 },
  { key: "lifetime", label: "Lifetime", days: null },
];
export const isRangeKey = (v: string): v is RangeKey => RANGES.some((r) => r.key === v);
export function rangeDays(range: RangeKey): number | null {
  return RANGES.find((r) => r.key === range)?.days ?? null;
}

export function filterByRange(videos: NormalizedVideo[], range: RangeKey, now: Date = new Date()): NormalizedVideo[] {
  const days = rangeDays(range);
  if (days == null) return videos;
  const from = now.getTime() - days * 86_400_000;
  return videos.filter((v) => v.publishedAt !== null && new Date(v.publishedAt).getTime() >= from);
}

function startOfDayUtc(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function isoDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}
function lifetimeDays(videos: NormalizedVideo[], now: Date): number {
  const times = videos
    .map((v) => (v.publishedAt ? new Date(v.publishedAt).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return 1;
  const earliest = Math.min(...times);
  return Math.max(1, Math.min(730, Math.ceil((now.getTime() - earliest) / 86_400_000) + 1));
}

export function dailySeries(videos: NormalizedVideo[], range: RangeKey, now: Date = new Date()): SeriesPoint[] {
  const days = rangeDays(range) ?? lifetimeDays(videos, now);
  const start = startOfDayUtc(now.getTime()) - (days - 1) * 86_400_000;
  const points = new Map<string, SeriesPoint>();
  for (let i = 0; i < days; i++) {
    const t = start + i * 86_400_000;
    points.set(isoDay(t), { date: isoDay(t), views: 0, likes: 0, comments: 0, uploads: 0 });
  }
  for (const v of videos) {
    if (!v.publishedAt) continue;
    const t = new Date(v.publishedAt).getTime();
    if (!Number.isFinite(t)) continue;
    const p = points.get(isoDay(startOfDayUtc(t)));
    if (!p) continue; // outside window — cumulative counts are never back-filled (honest)
    p.views += v.views;
    p.likes += v.likes;
    p.comments += v.comments;
    p.uploads += 1;
  }
  return [...points.values()];
}

export function totals(videos: NormalizedVideo[]): Totals {
  let views = 0, likes = 0, comments = 0, weightedSecs = 0, viewsWithDuration = 0;
  for (const v of videos) {
    views += v.views;
    likes += v.likes;
    comments += v.comments;
    if (v.durationSeconds !== null && v.durationSeconds > 0) {
      weightedSecs += v.views * v.durationSeconds;
      viewsWithDuration += v.views;
    }
  }
  return {
    views, likes, comments, uploads: videos.length,
    estWatchHours: viewsWithDuration > 0 ? weightedSecs / 3600 : null,
  };
}

export function topVideos(videos: NormalizedVideo[], n = 10): NormalizedVideo[] {
  return [...videos].sort((a, b) => b.views - a.views).slice(0, n);
}
