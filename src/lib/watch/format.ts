/**
 * WFX2-W formatting utilities (YouTube display conventions).
 */

/** "289K" / "1.2M" / "9,841" — YouTube compact counts. */
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const v = n / 1000;
    const s = v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "");
    return `${s}K`;
  }
  if (n < 1_000_000_000) {
    const v = n / 1_000_000;
    const s = v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "");
    return `${s}M`;
  }
  const v = n / 1_000_000_000;
  return `${v.toFixed(1).replace(/\.0$/, "")}B`;
}

/** "12:14" or "1:02:03"; null (live/unknown) → "". */
export function formatDuration(totalSec: number | null): string {
  if (totalSec === null || totalSec === undefined) return "";
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "3 minutes ago" / "15 years ago" — YouTube relative ages; null → "". */
export function relativeTime(iso: string | Date | null, now: Date = new Date()): string {
  if (iso === null || iso === undefined) return "";
  const then = typeof iso === "string" ? new Date(iso) : iso;
  const sec = Math.max(1, Math.floor((now.getTime() - then.getTime()) / 1000));
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (sec < 60) return plural(sec, "second");
  const min = Math.floor(sec / 60);
  if (min < 60) return plural(min, "minute");
  const hr = Math.floor(min / 60);
  if (hr < 24) return plural(hr, "hour");
  const day = Math.floor(hr / 24);
  if (day < 7) return plural(day, "day");
  const week = Math.floor(day / 7);
  if (week < 5) return plural(week, "week");
  const month = Math.floor(day / 30.44);
  if (month < 12) return plural(month, "month");
  const year = Math.floor(day / 365.25);
  return plural(year, "year");
}

/** "Nov 10, 2014"; null → "". */
export function fullDate(iso: string | Date | null): string {
  if (iso === null || iso === undefined) return "";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

/** "23,436,439" */
export function exactCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}
