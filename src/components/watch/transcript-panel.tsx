"use client";

/**
 * WFX2-W transcript panel — cue list with active-cue highlight as the
 * playhead passes, click-to-seek, auto-scroll to the active cue, and a
 * search-in-transcript filter box.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/watch/format";
import { activeCueIndex } from "@/lib/watch/transcript";
import type { TranscriptCueDto } from "@/lib/watch/types";

export function TranscriptPanel({
  cues,
  getTime,
  query,
  onQueryChange,
  onSeek,
  onClose,
}: {
  cues: TranscriptCueDto[];
  getTime: () => number;
  query: string;
  onQueryChange: (q: string) => void;
  onSeek: (sec: number) => void;
  onClose: () => void;
}) {
  const [now, setNow] = useState(() => getTime());
  const activeIdx = useMemo(() => activeCueIndex(cues, now), [cues, now]);
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
    if (!q) return cues;
    return cues.filter((c) => c.text.toLowerCase().includes(q));
  }, [cues, query]);

  return (
    <section
      aria-label="Transcript"
      className="mt-3 overflow-hidden rounded-xl border border-border bg-card/40"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <h2 className="text-sm font-semibold">Transcript</h2>
        <div className="ml-auto flex items-center gap-1.5">
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
        {filtered.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            {cues.length === 0
              ? "No transcript available for this video."
              : `No cues match "${query}".`}
          </p>
        ) : (
          filtered.map((cue) => {
            const idx = cues.indexOf(cue);
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
