"use client";

/**
 * WFX2-W transcript panel — cue list with active-cue highlight as the
 * playhead passes, click-to-seek, auto-scroll to the active cue, and a
 * search-in-transcript filter box.
 *
 * WFX2-P4-QT — transcript language: a selector fed by the InnerTube
 * caption-tracks list for THIS video (/transcript/languages), per-language
 * cue fetch (/transcript?lang=xx), the honest unavailable states (no track
 * for the language; upstream failure), and per-video selection persistence
 * (session storage — never fabricated tracks).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/watch/format";
import { activeCueIndex } from "@/lib/watch/transcript";
import { api } from "@/lib/watch/client";
import type { TranscriptCueDto } from "@/lib/watch/types";

/** One selectable transcript language (the wire DTO from /transcript/languages). */
export interface TranscriptLanguageOption {
  languageCode: string;
  name: string;
  /** "asr" → auto-generated captions (YouTube's "(auto-generated)" suffix) */
  kind: "asr" | null;
}

/* ------------------------------------------------------------------ */
/* Per-video language persistence (session storage, at most)           */
/* ------------------------------------------------------------------ */

export const TRANSCRIPT_LANG_STORAGE_PREFIX = "wfx2-transcript-lang:";

export function transcriptLangKey(videoId: string): string {
  return `${TRANSCRIPT_LANG_STORAGE_PREFIX}${videoId}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The persisted language for this video ("" → default; null → none). */
export function readTranscriptLangPref(
  storage: StorageLike | null | undefined,
  videoId: string
): string | null {
  try {
    return storage?.getItem(transcriptLangKey(videoId)) ?? null;
  } catch {
    return null;
  }
}

/** Persist the selection per video ("" removes the preference). */
export function writeTranscriptLangPref(
  storage: StorageLike | null | undefined,
  videoId: string,
  lang: string
): void {
  try {
    if (lang) storage?.setItem(transcriptLangKey(videoId), lang);
    else storage?.removeItem(transcriptLangKey(videoId));
  } catch {
    /* private mode — the selection stays for this mount only */
  }
}

/**
 * Dedupe the track list into one option per languageCode (a manual track
 * beats an auto-generated one — the same preference the per-language fetch
 * applies). Pure — exported for tests.
 */
export function dedupeLanguageOptions(
  tracks: TranscriptLanguageOption[]
): TranscriptLanguageOption[] {
  const byCode = new Map<string, TranscriptLanguageOption>();
  for (const t of tracks) {
    const existing = byCode.get(t.languageCode);
    if (!existing || (existing.kind === "asr" && t.kind !== "asr")) {
      byCode.set(t.languageCode, t);
    }
  }
  return [...byCode.values()];
}

type LanguageCueStatus = "idle" | "loading" | "ok" | "empty" | "error";

export function TranscriptPanel({
  videoId,
  cues,
  getTime,
  query,
  onQueryChange,
  onSeek,
  onClose,
}: {
  videoId: string;
  cues: TranscriptCueDto[];
  getTime: () => number;
  query: string;
  onQueryChange: (q: string) => void;
  onSeek: (sec: number) => void;
  onClose: () => void;
}) {
  // "" → the default transcript (the page's seeded cues); a code → live track.
  // The panel is conditionally mounted (client-only, after a click — never
  // SSR'd), so the lazy initializer safely restores the per-video persisted
  // selection without a hydration mismatch.
  const [lang, setLang] = useState(() =>
    readTranscriptLangPref(
      typeof window === "undefined" ? null : window.sessionStorage,
      videoId
    ) ?? ""
  );
  const [langCues, setLangCues] = useState<TranscriptCueDto[]>([]);
  const [langStatus, setLangStatus] = useState<LanguageCueStatus>(() =>
    readTranscriptLangPref(
      typeof window === "undefined" ? null : window.sessionStorage,
      videoId
    )
      ? "loading"
      : "idle"
  );
  const [langError, setLangError] = useState<string | null>(null);
  /** null → loading; [] → no tracks (selector hidden); tracks → options */
  const [tracks, setTracks] = useState<TranscriptLanguageOption[] | null>(null);

  const [now, setNow] = useState(() => getTime());

  // the caption-tracks list for this video (async results only — the panel
  // is keyed per video, so a fresh mount carries fresh state)
  useEffect(() => {
    let alive = true;
    api<{ tracks: TranscriptLanguageOption[] }>(
      `/api/videos/${videoId}/transcript/languages`
    )
      .then((r) => {
        if (alive) setTracks(dedupeLanguageOptions(r.tracks));
      })
      .catch(() => {
        // honest degrade: languages unavailable → the default transcript
        // stays; the selector simply doesn't surface
        if (alive) setTracks([]);
      });
    return () => {
      alive = false;
    };
  }, [videoId]);

  // per-language fetch ("" short-circuits — the default cues are the page's)
  useEffect(() => {
    if (lang === "") return;
    let alive = true;
    api<{ cues: TranscriptCueDto[] }>(
      `/api/videos/${videoId}/transcript?lang=${encodeURIComponent(lang)}`
    )
      .then((r) => {
        if (!alive) return;
        setLangCues(r.cues);
        setLangStatus(r.cues.length === 0 ? "empty" : "ok");
      })
      .catch((e) => {
        if (!alive) return;
        setLangCues([]);
        setLangStatus("error");
        setLangError(
          e instanceof Error ? e.message : "Failed to load the transcript for this language"
        );
      });
    return () => {
      alive = false;
    };
  }, [lang, videoId]);

  const onLangChange = (code: string) => {
    setLang(code);
    setLangStatus(code === "" ? "idle" : "loading");
    setLangError(null);
    writeTranscriptLangPref(
      typeof window === "undefined" ? null : window.sessionStorage,
      videoId,
      code
    );
  };

  // the ACTIVE cue set: the page's default cues, or the fetched language's
  const activeCues = lang === "" ? cues : langCues;
  const activeIdx = useMemo(() => activeCueIndex(activeCues, now), [activeCues, now]);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // poll the playhead so the active cue follows playback (panel-local re-render)
  useEffect(() => {
    const interval = setInterval(() => setNow(getTime()), 400);
    return () => clearInterval(interval);
  }, [getTime]);

  // auto-scroll the active cue into view (the YouTube behavior)
  useEffect(() => {
    if (activeRef.current && listRef.current) {
      const list = listRef.current;
      const el = activeRef.current;
      const listRect = list.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      if (elRect.top < listRect.top + 8 || elRect.bottom > listRect.bottom - 8) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [activeIdx]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeCues;
    return activeCues.filter((c) => c.text.toLowerCase().includes(q));
  }, [activeCues, query]);

  const showSelector = (tracks?.length ?? 0) > 0;

  return (
    <section
      aria-label="Transcript"
      className="mt-3 overflow-hidden rounded-xl border border-border bg-card/40"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <h2 className="text-sm font-semibold">Transcript</h2>
        <div className="ml-auto flex items-center gap-1.5">
          {/* WFX2-P4-QT: the language selector — real caption tracks only */}
          {showSelector && (
            <select
              value={lang}
              onChange={(e) => onLangChange(e.target.value)}
              aria-label="Transcript language"
              className="h-8 rounded-full border border-border bg-background px-2 pr-6 text-xs outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">Default</option>
              {tracks!.map((t) => (
                <option key={t.languageCode} value={t.languageCode}>
                  {/* the NAME as YouTube itself renders it — asr tracks already
                      carry "(auto-generated)" in their name; never double-label */}
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search transcript"
              aria-label="Search transcript"
              className="h-8 w-36 rounded-full border border-border bg-background pl-8 pr-3 text-xs outline-none transition focus:w-48 focus-visible:ring-1 focus-visible:ring-ring sm:w-44 sm:focus:w-56"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close transcript"
            className="flex size-8 items-center justify-center rounded-full transition hover:bg-accent"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        ref={listRef}
        className="max-h-[360px] overflow-y-auto px-2 py-2"
        role="document"
        aria-label="Transcript cues"
      >
        {langStatus === "loading" ? (
          <div className="space-y-1.5 px-2 py-2" aria-busy="true" aria-label="Loading transcript">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-6 animate-pulse rounded-lg bg-secondary" />
            ))}
          </div>
        ) : langStatus === "error" ? (
          /* the honest unavailable state — upstream failed for this language */
          <p role="alert" className="px-3 py-8 text-center text-sm text-muted-foreground">
            {langError ?? "No transcript available for this language."}
          </p>
        ) : langStatus === "empty" ? (
          /* the honest unavailable state — no cues on this track */
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            No transcript available for this language.
          </p>
        ) : filtered.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            {activeCues.length === 0
              ? "No transcript available for this video."
              : `No cues match "${query}".`}
          </p>
        ) : (
          filtered.map((cue) => {
            const idx = activeCues.indexOf(cue);
            const active = idx === activeIdx;
            return (
              <button
                key={cue.id}
                ref={active ? activeRef : undefined}
                type="button"
                onClick={() => onSeek(cue.startSec)}
                aria-current={active ? "true" : undefined}
                aria-label={`Seek to ${formatDuration(cue.startSec)}: ${cue.text}`}
                className={cn(
                  "flex w-full gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-accent/60",
                  active && "bg-secondary/70"
                )}
              >
                <span
                  className={cn(
                    "shrink-0 pt-0.5 text-xs font-medium tabular-nums",
                    active ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {formatDuration(cue.startSec)}
                </span>
                <span
                  className={cn(
                    "text-sm leading-relaxed",
                    active ? "text-foreground" : "text-foreground/80"
                  )}
                >
                  {highlight(cue.text, query)}
                </span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let last = 0;
  let i = lower.indexOf(lowerQ);
  let key = 0;
  while (i !== -1) {
    if (i > last) parts.push(text.slice(last, i));
    parts.push(
      <mark key={key++} className="rounded bg-yellow-200/70 px-0.5 text-foreground dark:bg-yellow-500/40">
        {text.slice(i, i + q.length)}
      </mark>
    );
    last = i + q.length;
    i = lower.indexOf(lowerQ, last);
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
