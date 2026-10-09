/**
 * P21-LIVE-PREMIERES — the watch page's premiere state, pure pieces:
 *
 *  - formatPremiereCountdown: "Premieres in 3 days" / "Premieres in 1 day"
 *    (D days) and "Premieres in 04:12:33" (HH:MM:SS under a day) —
 *    YouTube's own two countdown forms, live-ticked per second by the
 *    component. Pure (remaining ms in → text out), unit-testable.
 *  - The "Set reminder" persistence: a WebFlix-owned UI preference stored
 *    in localStorage (key wf-premiere-reminders, a JSON array of video
 *    ids). The standing law: YouTube is the user-data source of truth and
 *    WebFlix stores UI prefs only — the actual reminder notification is
 *    youtube.com's (the honest disclosure the stage renders next to the
 *    bell). Total functions: never throw (private mode swallows).
 */

/** The localStorage key for the WebFlix-side reminder set. */
export const PREMIERE_REMINDERS_KEY = "wf-premiere-reminders";

/**
 * The minimal storage surface the reminder set needs (the DOM Storage
 * subset — window.localStorage satisfies it; tests pass lighter shims).
 */
export type PremiereStorage = Pick<Storage, "getItem" | "setItem">;

const DAY_MS = 86_400_000;

/**
 * YouTube's premiere countdown wording from the remaining ms:
 *  - ≥ 1 day  → "3 days" / "1 day"
 *  - < 1 day  → "04:12:33" (HH:MM:SS, hours unbounded, ticking)
 * The caller prefixes ("Premieres in …"); this returns the duration text.
 */
export function formatPremiereCountdown(remainingMs: number): string {
  const ms = Math.max(0, remainingMs);
  if (ms >= DAY_MS) {
    const days = Math.floor(ms / DAY_MS);
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** The full countdown line: "Premieres in 3 days" / "Premieres in 04:12:33". */
export function premiereCountdownLine(remainingMs: number): string {
  return `Premieres in ${formatPremiereCountdown(remainingMs)}`;
}

/**
 * The scheduled date in YouTube's dateText wording ("Oct 9, 2026") — UTC,
 * matching the watch mapper's UTC-midnight parse of "Scheduled for …"
 * byte-for-byte (a local-timezone format could shift the day; the exact
 * clock time stays YouTube's, per `next`'s date-only wording).
 */
export function premiereScheduledDate(startsAtIso: string): string {
  const d = new Date(startsAtIso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** Wall-clock ms until the start (clamped at 0; Infinity-safe → 0). */
export function premiereRemainingMs(startsAtIso: string, now: number): number {
  const startsAt = Date.parse(startsAtIso);
  if (!Number.isFinite(startsAt)) return 0;
  return Math.max(0, startsAt - now);
}

/**
 * Read the stored reminder set. Total: null/missing/corrupt storage → an
 * empty set (never throws, never invents an id).
 */
export function readPremiereReminders(storage: PremiereStorage | null | undefined): string[] {
  if (!storage) return [];
  let raw: string | null = null;
  try {
    raw = storage.getItem(PREMIERE_REMINDERS_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0))];
  } catch {
    return [];
  }
}

/** Persist the reminder set (best-effort — private mode swallows). */
export function writePremiereReminders(storage: PremiereStorage | null | undefined, ids: string[]): void {
  if (!storage) return;
  try {
    storage.setItem(PREMIERE_REMINDERS_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    /* private mode */
  }
}

/**
 * Toggle one video's reminder. Returns the NEW state (true = reminder set).
 * WebFlix-owned pref only — the youtube.com notification itself is not
 * ours to set (the honest split the stage discloses).
 */
export function togglePremiereReminder(storage: PremiereStorage | null | undefined, videoId: string): boolean {
  const current = readPremiereReminders(storage);
  const has = current.includes(videoId);
  const next = has ? current.filter((id) => id !== videoId) : [...current, videoId];
  writePremiereReminders(storage, next);
  return !has;
}
