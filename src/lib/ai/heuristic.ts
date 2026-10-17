/**
 * P23-B (G3/G4) — the shared, PURE ask-AI layer (client-safe).
 *
 * Everything here is importable from client components: no SDK, no env, no
 * fetch. The conversational-query heuristic decides when the search answer
 * card fires; the token splitters render the AI answers (citation chips +
 * seek chips); the suggested-prompt builder feeds the watch Ask panel; the
 * response DTOs are the wire contract both sides share.
 */
import { parseClockTime, type Chapter } from "@/lib/watch/chapters";

// ---------------------------------------------------------------------------
// The conversational-query heuristic (G3 — when does the answer card fire?)
// ---------------------------------------------------------------------------

const QUESTION_STARTERS =
  /^(?:who|what|why|how|when|where|which|is|are|can|do|does|whats|whos|hows|whys|whens|wheres)\b/i;

/**
 * A query is conversational when it ends with "?", starts with a question
 * word, or is a long natural-language phrase. Quoted / exact-match searches
 * are keyword intent — the card never fires for them.
 */
export function isConversationalQuery(q: string): boolean {
  const s = q.trim();
  if (s.length < 3 || s.length > 500) return false;
  if (/["“”']/.test(s)) return false;
  if (s.endsWith("?")) return true;
  if (QUESTION_STARTERS.test(s)) return true;
  return s.split(/\s+/).filter(Boolean).length >= 6;
}

// ---------------------------------------------------------------------------
// Suggested prompts (G4 — the Ask panel's empty state)
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Title- and chapter-derived starter questions (deduped, capped at 5). */
export function suggestedAskPrompts(title: string, chapters: Pick<Chapter, "title">[]): string[] {
  const prompts: string[] = ["What is this video about?", "Summarize the key points"];
  const clean = title.trim();
  if (clean) prompts.push(`What does “${truncate(clean, 60)}” cover?`);
  for (const ch of chapters.slice(0, 2)) {
    const t = ch.title?.trim();
    if (t) prompts.push(`What happens in “${truncate(t, 48)}”?`);
  }
  return [...new Set(prompts)].slice(0, 5);
}

// ---------------------------------------------------------------------------
// Answer token parsing (shared by the routes' validation + the cards' render)
// ---------------------------------------------------------------------------

export interface AskCitation {
  n: number;
  videoId: string;
  title: string;
  channelName: string;
}

export interface AskSeek {
  sec: number;
  label: string;
}

export interface KeyMoment {
  sec: number;
  label: string;
  /** the REAL chapter title at that timestamp (grounded — never LLM-invented) */
  title: string;
}

/** m:ss or h:mm:ss from seconds. */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

const SEEK_TOKEN_RE = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;

/**
 * The [m:ss] timestamps in an answer, validated against the REAL moments
 * (chapter/cue starts) — fabricated ones are dropped, survivors deduped.
 * Server-side (the route's `seeks` payload).
 */
export function parseAnswerSeeks(answer: string, validSecs: ReadonlySet<number>): AskSeek[] {
  const out: AskSeek[] = [];
  const seen = new Set<number>();
  for (const m of answer.matchAll(SEEK_TOKEN_RE)) {
    const sec = parseClockTime(m[1]);
    if (sec === null || !validSecs.has(sec) || seen.has(sec)) continue;
    seen.add(sec);
    out.push({ sec, label: m[1] });
  }
  return out;
}

export type AnswerSegment =
  | { kind: "text"; text: string; start: number }
  | { kind: "citation"; n: number; start: number }
  | { kind: "seek"; sec: number; label: string; start: number };

const ANY_TOKEN_RE = /\[(\d{1,3})\]|\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;

/**
 * Split an AI answer into text / citation-chip / seek-chip segments for
 * rendering. A [n] token is a chip only when 1 ≤ n ≤ opts.citations; a
 * [m:ss] token is a chip only when the ROUTE validated that exact label
 * (fabricated timestamps stay plain text). `start` = the segment's offset
 * into the full answer (the type-out reveal gates on it).
 */
export function splitAnswerSegments(
  answer: string,
  opts: { citations: number; seeks: AskSeek[] }
): AnswerSegment[] {
  const byLabel = new Map(opts.seeks.map((s) => [s.label, s]));
  const segments: AnswerSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  ANY_TOKEN_RE.lastIndex = 0;
  while ((m = ANY_TOKEN_RE.exec(answer))) {
    if (m.index > last) {
      segments.push({ kind: "text", text: answer.slice(last, m.index), start: last });
    }
    if (m[1] !== undefined) {
      const n = Number(m[1]);
      if (n >= 1 && n <= opts.citations) {
        segments.push({ kind: "citation", n, start: m.index });
      } else {
        segments.push({ kind: "text", text: m[0], start: m.index });
      }
    } else if (m[2] !== undefined) {
      const seek = byLabel.get(m[2]);
      if (seek) {
        segments.push({ kind: "seek", sec: seek.sec, label: seek.label, start: m.index });
      } else {
        segments.push({ kind: "text", text: m[0], start: m.index });
      }
    }
    last = m.index + m[0].length;
  }
  if (last < answer.length) {
    segments.push({ kind: "text", text: answer.slice(last), start: last });
  }
  return segments;
}

// ---------------------------------------------------------------------------
// The wire DTOs (routes + client components share these shapes)
// ---------------------------------------------------------------------------

export type SearchAskResponse =
  | { status: "disabled" }
  | { status: "no-results" }
  | { status: "ok"; answer: string; citations: AskCitation[] };

export type WatchAskResponse =
  | { status: "disabled" }
  | { status: "ok"; answer: string; seeks: AskSeek[] };

export type WatchSummaryResponse =
  | { status: "disabled" }
  | { status: "ok"; summary: string; keyMoments: KeyMoment[] };
