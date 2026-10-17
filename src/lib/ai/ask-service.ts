/**
 * P23-B (G3/G4) — the ask-AI service: prompt construction + answer parsing
 * + the watch grounding ladder. Runs server-side (route handlers only).
 *
 * Grounding laws:
 *  - G3 answers are built from the REAL search results (title / channel /
 *    description snippet) the user sees — citations map to those videos.
 *  - G4 answers are built from the video's REAL metadata + chapters +
 *    transcript; [m:ss] timestamps survive only when they land exactly on a
 *    chapter start or a transcript cue start (fabricated ones are dropped).
 *  - The AI summary's Key moments ride the REAL chapter timestamps only.
 */
import { parseChapters, parseClockTime, type Chapter } from "@/lib/watch/chapters";
import type { TranscriptCueDto } from "@/lib/watch/types";
import { getTranscript } from "@/lib/watch/transcript-service";
import { fetchCaptionCues, getCaptionTracks } from "@/lib/youtube/captions";
import { formatClock, parseAnswerSeeks, type AskSeek, type KeyMoment } from "./heuristic";
import type { LlmMessage } from "./llm";

/** AI answers are deterministic per (video, question) — cache them 10 min. */
export const AI_ANSWER_TTL_MS = 10 * 60_000;
/** How many top search results ground a G3 answer. */
export const ASK_GROUNDING_RESULTS = 8;
/** The transcript excerpt budget fed to the model (chars). */
export const ASK_TRANSCRIPT_MAX_CHARS = 12_000;

// ---------------------------------------------------------------------------
// G3 — Ask-search
// ---------------------------------------------------------------------------

export interface AskGroundingVideo {
  id: string;
  title: string;
  channelName: string;
  description: string;
}

export function buildSearchAskMessages(q: string, results: AskGroundingVideo[]): LlmMessage[] {
  const numbered = results
    .map((r, i) => {
      const snippet = r.description.replace(/\s+/g, " ").trim().slice(0, 160);
      return `[${i + 1}] ${r.title} — ${r.channelName}${snippet ? ` — ${snippet}` : ""}`;
    })
    .join("\n");
  return [
    {
      role: "system",
      content:
        "You are the AI answers feature of a video site. Answer the user's question using ONLY the numbered search results provided. Cite every result you rely on inline as [n], using the exact bracket numbers from the list. Never invent videos, channels, or facts that are not in the results. If the results do not answer the question, say so plainly in one sentence. Answer in 2-4 sentences, neutral tone, no headings, no lists.",
    },
    {
      role: "user",
      content: `Question: ${q}\n\nSearch results:\n${numbered}\n\nAnswer:`,
    },
  ];
}

// ---------------------------------------------------------------------------
// G4 — Ask about this video (+ the AI summary)
// ---------------------------------------------------------------------------

export interface WatchAskGrounding {
  title: string;
  channelName: string;
  description: string;
  chapters: Chapter[];
  cues: TranscriptCueDto[];
}

/**
 * The transcript ladder for grounding: WebFlix-local transcript rows first
 * (the seeded/store videos), then the real caption track (English preferred,
 * first otherwise) — [] when neither serves (the honest degrade: the answer
 * grounds on title/description/chapters only).
 */
export async function resolveAskTranscript(videoId: string): Promise<TranscriptCueDto[]> {
  try {
    const cues = await getTranscript(videoId);
    if (cues.length > 0) return cues;
  } catch {
    /* not a WebFlix-local video — the captions ladder below */
  }
  try {
    const tracks = await getCaptionTracks(videoId);
    if (tracks.length === 0) return [];
    const track = tracks.find((t) => t.languageCode === "en") ?? tracks[0];
    return await fetchCaptionCues(videoId, track.languageCode);
  } catch {
    return [];
  }
}

/** Evenly sample cues down to the char budget (first + last always kept). */
export function sampleCues(cues: TranscriptCueDto[], maxChars: number): TranscriptCueDto[] {
  if (cues.length < 2) return cues;
  const size = (c: TranscriptCueDto) => formatClock(c.startSec).length + c.text.length + 4;
  let total = 0;
  for (const c of cues) total += size(c);
  if (total <= maxChars) return cues;
  const keepEvery = Math.ceil(total / maxChars);
  const out = cues.filter((_, i) => i % keepEvery === 0);
  const last = cues[cues.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function groundingText(g: WatchAskGrounding): string {
  const parts: string[] = [`Video: ${g.title}`, `Channel: ${g.channelName}`];
  const desc = g.description.replace(/\s+/g, " ").trim().slice(0, 800);
  if (desc) parts.push(`Description: ${desc}`);
  if (g.chapters.length > 0) {
    parts.push("Chapters (real timestamps):");
    for (const c of g.chapters) parts.push(`- [${formatClock(c.startSec)}] ${c.title}`);
  }
  const cues = sampleCues(g.cues, ASK_TRANSCRIPT_MAX_CHARS);
  if (cues.length > 0) {
    parts.push("Transcript (real timestamps):");
    for (const c of cues) parts.push(`[${formatClock(c.startSec)}] ${c.text.replace(/\s+/g, " ").trim()}`);
  }
  return parts.join("\n");
}

export function buildWatchAskMessages(question: string, g: WatchAskGrounding): LlmMessage[] {
  return [
    {
      role: "system",
      content:
        "You answer questions about a single video, using ONLY the video information provided (title, channel, description, chapters, transcript). Cite the moments you rely on inline as [m:ss] or [h:mm:ss] — ONLY using timestamps that appear in the provided chapters or transcript, never invented ones. If the provided material does not answer the question, say so plainly. Answer in 2-5 sentences, no headings, no lists.",
    },
    {
      role: "user",
      content: `${groundingText(g)}\n\nQuestion: ${question}\n\nAnswer:`,
    },
  ];
}

/**
 * The answer's [m:ss] chips — validated against the REAL moments (chapter
 * starts + cue starts). Fabricated timestamps are dropped here, server-side.
 */
export function answerSeeksFor(answer: string, g: WatchAskGrounding): AskSeek[] {
  const valid = new Set<number>([
    ...g.chapters.map((c) => c.startSec),
    ...g.cues.map((c) => c.startSec),
  ]);
  return parseAnswerSeeks(answer, valid);
}

export function buildSummaryMessages(g: WatchAskGrounding): LlmMessage[] {
  const chapterLaw = g.chapters.length
    ? " After the summary, list the most important chapters as key moments, one per line, each exactly: KEYMOMENT m:ss - one short phrase. Choose ONLY timestamps that appear in the chapters list. 3 to 6 key moments."
    : " The video has no chapters — do not list any key moments.";
  return [
    {
      role: "system",
      content: `You summarize a single video, using ONLY the video information provided (title, channel, description, chapters${g.cues.length ? ", transcript" : ""}). Write a 3-5 sentence neutral summary of what the video covers. Never invent facts.${chapterLaw}`,
    },
    {
      role: "user",
      content: `${groundingText(g)}\n\nSummary:`,
    },
  ];
}

/**
 * Parse the summary + its KEYMOMENT lines. A key moment survives ONLY when
 * its timestamp matches a real chapter start exactly; the chip's title is
 * the REAL chapter title (the LLM's phrase is display copy, the timestamp
 * and chapter binding are ours).
 */
export function parseSummary(
  raw: string,
  chapters: Chapter[]
): { summary: string; keyMoments: KeyMoment[] } {
  const lines = raw.split(/\r?\n/);
  const summaryLines: string[] = [];
  const moments: KeyMoment[] = [];
  const seen = new Set<number>();
  let inMoments = false;
  for (const line of lines) {
    const m = /^\s*KEYMOMENT[:\s]+(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*[-–—]\s*(.*))?\s*$/i.exec(line);
    if (m) {
      inMoments = true;
      const sec = parseClockTime(m[1]);
      const chapter = sec === null ? undefined : chapters.find((c) => c.startSec === sec);
      if (sec !== null && chapter && !seen.has(sec)) {
        seen.add(sec);
        moments.push({ sec, label: m[1], title: chapter.title });
      }
      continue;
    }
    if (!inMoments) summaryLines.push(line);
  }
  return { summary: summaryLines.join("\n").trim(), keyMoments: moments };
}

/** Chapters from a watch description (server-side re-derivation when the
 *  upstream mapper did not populate them). */
export function chaptersFromDescription(description: string, durationSec: number | null): Chapter[] {
  return parseChapters(description, durationSec);
}
