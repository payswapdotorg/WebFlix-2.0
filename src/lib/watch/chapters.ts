/**
 * WFX2-W description parsing — chapters + hashtags (YouTube conventions).
 */

export interface Chapter {
  startSec: number;
  endSec: number;
  title: string;
}

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** "1:02:03" | "2:07" → seconds (null if unparseable). */
export function parseClockTime(s: string): number | null {
  const m = TIME_RE.exec(s.trim());
  if (!m) return null;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  if (m[3] !== undefined) {
    return a * 3600 + b * 60 + parseInt(m[3], 10);
  }
  return a * 60 + b;
}

/**
 * Parse chapters from a description. YouTube rules:
 * - one timestamp + title per line; the FIRST chapter must start at 0:00;
 * - chapters only activate with ≥ 2 valid timestamps and a 0:00 entry;
 * - each chapter ends where the next begins (last ends at duration).
 */
export function parseChapters(description: string, durationSec: number): Chapter[] {
  const lines = description.split(/\r?\n/);
  const found: { start: number; title: string }[] = [];
  for (const line of lines) {
    const m = /^\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:[-–—:)\]]\s*)?(.+?)\s*$/.exec(line);
    if (!m) continue;
    const start = parseClockTime(m[1]);
    if (start === null) continue;
    const title = m[2].trim();
    if (!title) continue;
    found.push({ start, title });
  }
  if (found.length < 2) return [];
  if (found[0].start !== 0) return [];
  // dedupe/normalize: strictly increasing starts, capped at duration
  const chapters: Chapter[] = [];
  for (const c of found) {
    if (c.start >= durationSec) continue;
    if (chapters.length && c.start <= chapters[chapters.length - 1].startSec) continue;
    chapters.push({ startSec: c.start, endSec: 0, title: c.title });
  }
  for (let i = 0; i < chapters.length; i++) {
    chapters[i].endSec =
      i + 1 < chapters.length ? chapters[i + 1].startSec : durationSec;
  }
  return chapters;
}

/** Active chapter at time t (last chapter whose start <= t). */
export function activeChapterIndex(chapters: Chapter[], t: number): number {
  if (!chapters.length) return -1;
  if (t < chapters[0].startSec) return -1;
  let idx = 0;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].startSec <= t) idx = i;
    else break;
  }
  return idx;
}

/** Unique hashtags in the description ("#b3d" style). */
export function parseHashtags(description: string): string[] {
  const out: string[] = [];
  for (const m of description.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)) {
    const tag = `#${m[1]}`;
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

/** Render token type for description body lines. */
export type DescToken =
  | { kind: "text"; text: string }
  | { kind: "hashtag"; tag: string; href: string }
  | { kind: "timestamp"; label: string; sec: number };

/** Split a description line into text / hashtag / timestamp tokens. */
export function tokenizeDescriptionLine(line: string): DescToken[] {
  const tokens: DescToken[] = [];
  const re = /(#[\p{L}\p{N}_-]+)|(\b\d{1,2}:\d{2}(?::\d{2})?\b)/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) tokens.push({ kind: "text", text: line.slice(last, m.index) });
    if (m[1]) {
      tokens.push({ kind: "hashtag", tag: m[1], href: `/search?q=${encodeURIComponent(m[1])}` });
    } else if (m[2]) {
      const sec = parseClockTime(m[2]);
      tokens.push({ kind: "timestamp", label: m[2], sec: sec ?? 0 });
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) tokens.push({ kind: "text", text: line.slice(last) });
  return tokens;
}
