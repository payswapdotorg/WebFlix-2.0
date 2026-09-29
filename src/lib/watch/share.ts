/**
 * WFX2-W share-link timestamp parsing.
 *
 * YouTube watch URLs accept `?t=` in several shapes:
 *   t=90  → 90 seconds
 *   t=90s → 90 seconds
 *   t=1m30s → 90 seconds
 *   t=1h2m3s → 3723 seconds
 *   t=1:30 → 90 seconds (clock form)
 *   t=1:02:03 → 3723 seconds
 */

const HM_S = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/i;
const CLOCK = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** Parse a `?t=` value to seconds; null when absent/unparseable. */
export function parseTimestampParam(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const s = value.trim();
  if (!s) return null;

  const clock = CLOCK.exec(s);
  if (clock) {
    const a = parseInt(clock[1], 10);
    const b = parseInt(clock[2], 10);
    if (clock[3] !== undefined) return a * 3600 + b * 60 + parseInt(clock[3], 10);
    return a * 60 + b;
  }

  const hms = HM_S.exec(s);
  if (hms && (hms[1] || hms[2] || hms[3])) {
    const h = hms[1] ? parseInt(hms[1], 10) : 0;
    const m = hms[2] ? parseInt(hms[2], 10) : 0;
    const sec = hms[3] ? parseInt(hms[3], 10) : 0;
    const total = h * 3600 + m * 60 + sec;
    if (Number.isFinite(total)) return total;
  }

  // plain integer seconds ("90")
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return null;
}

/** Build the share URL's `t` parameter (YouTube uses compact "1m30s" form). */
export function formatTimestampParam(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  let out = "";
  if (h) out += `${h}h`;
  if (m) out += `${m}m`;
  if (rest || !out) out += `${rest}s`;
  return out;
}
