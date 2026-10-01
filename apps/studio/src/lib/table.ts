import type { NormalizedVideo, VideoKind, Visibility } from "./types";

export type ContentTab = "videos" | "shorts" | "live" | "posts";

const TAB_KIND: Record<Exclude<ContentTab, "posts">, VideoKind> = {
  videos: "video",
  shorts: "short",
  live: "live",
};

export function filterByTab(videos: NormalizedVideo[], tab: ContentTab): NormalizedVideo[] {
  if (tab === "posts") return [];
  const kind = TAB_KIND[tab];
  return videos.filter((v) => v.kind === kind);
}

export function paginate<T>(items: T[], page: number, perPage: number): T[] {
  const start = (Math.max(1, page) - 1) * perPage;
  return items.slice(start, start + perPage);
}
export function pageCount(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / perPage));
}

// Day-math presets (deterministic; calendar-month math is intentionally avoided).
export const DATE_PRESETS = [
  { key: "all", label: "All time", days: null },
  { key: "today", label: "Today", days: 1 },
  { key: "week", label: "This week", days: 7 },
  { key: "month", label: "This month", days: 31 },
  { key: "year", label: "This year", days: 365 },
] as const;
export type DatePresetKey = (typeof DATE_PRESETS)[number]["key"];

export function filterByDatePreset(videos: NormalizedVideo[], preset: DatePresetKey, now: Date = new Date()): NormalizedVideo[] {
  const p = DATE_PRESETS.find((x) => x.key === preset);
  if (!p || p.days == null) return videos;
  const from = now.getTime() - p.days * 86_400_000;
  return videos.filter((v) => v.publishedAt !== null && new Date(v.publishedAt).getTime() >= from);
}

export function shareableLink(mainAppUrl: string, videoId: string): string {
  return `${mainAppUrl.replace(/\/$/, "")}/watch?v=${videoId}`;
}

export function visibilityBadge(v: Visibility): { label: string; className: string } {
  switch (v) {
    case "public": return { label: "Public", className: "border-green-200 bg-green-50 text-green-700" };
    case "unlisted": return { label: "Unlisted", className: "border-amber-200 bg-amber-50 text-amber-700" };
    case "private": return { label: "Private", className: "border-border bg-muted text-muted-foreground" };
  }
}

export function fmtNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function timeAgo(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(1, Math.floor((now.getTime() - t) / 1000));
  const steps: Array<[number, string]> = [
    [60, "second"], [3600, "minute"], [86400, "hour"], [604_800, "day"],
    [2_629_800, "week"], [31_557_600, "month"], [Infinity, "year"],
  ];
  let prev = 1;
  for (const [limit, unit] of steps) {
    if (s < limit) {
      const n = Math.max(1, Math.floor(s / prev));
      return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
    }
    prev = limit;
  }
  return "—";
}
