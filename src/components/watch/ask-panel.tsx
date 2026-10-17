"use client";

/**
 * P23-B (G4) — the watch page's Ask panel (youtube.com's "Ask about this
 * video" family). Mounted in the aside IN PLACE OF the related rail while
 * open (closing restores the rail); the thread scrolls independently of the
 * page.
 *
 * Suggested prompts derive from the video's own title + chapters. Answers
 * carry [:ss] seek chips that seek the real player (validated server-side
 * against chapter/cue timestamps — a fabricated one renders as plain text).
 * Honest degradation: {status:"disabled"} → the honest "not available" note
 * (the user opened the panel deliberately — hiding would be a dead button);
 * failures → the honest error + per-question Retry.
 */
import { useState } from "react";
import { SendHorizontal, Sparkles, X } from "lucide-react";
import { postJson } from "@/hooks/use-api";
import {
  splitAnswerSegments,
  suggestedAskPrompts,
  type AskSeek,
  type WatchAskResponse,
} from "@/lib/ai/heuristic";
import type { Chapter } from "@/lib/watch/chapters";

interface AskTurn {
  id: number;
  question: string;
  status: "loading" | "ok" | "error" | "disabled";
  answer?: string;
  seeks?: AskSeek[];
  error?: string;
}

export function AskPanel({
  videoId,
  title,
  chapters,
  onSeek,
  onClose,
}: {
  videoId: string;
  title: string;
  chapters: Chapter[];
  onSeek: (sec: number) => void;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<AskTurn[]>([]);
  const [input, setInput] = useState("");
  const [disabled, setDisabled] = useState(false);
  const nextId = 1 + (turns.length ? Math.max(...turns.map((t) => t.id)) : 0);

  const suggestions = turns.length === 0 ? suggestedAskPrompts(title, chapters) : [];

  async function ask(question: string) {
    const q = question.trim();
    if (!q || disabled) return;
    const turn: AskTurn = { id: nextId, question: q, status: "loading" };
    setTurns((t) => [...t, turn]);
    try {
      const r = await postJson<WatchAskResponse>(`/api/videos/${videoId}/ask`, { question: q });
      setTurns((t) =>
        t.map((x) =>
          x.id !== turn.id
            ? x
            : r.status === "ok"
              ? { ...x, status: "ok", answer: r.answer, seeks: r.seeks }
              : r.status === "disabled"
                ? { ...x, status: "disabled" }
                : x
        )
      );
      if (r.status === "disabled") setDisabled(true);
    } catch (e) {
      setTurns((t) =>
        t.map((x) =>
          x.id === turn.id
            ? {
                ...x,
                status: "error",
                error: e instanceof Error ? e.message : "The AI answer failed",
              }
            : x
        )
      );
    }
  }

  function retry(turn: AskTurn) {
    setTurns((t) => t.filter((x) => x.id !== turn.id));
    void ask(turn.question);
  }

  return (
    <section
      aria-label="Ask about this video"
      data-testid="ask-panel"
      className="flex flex-col overflow-hidden rounded-xl border border-border bg-card/40"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Sparkles className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Ask about this video</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Ask and show related videos"
          data-testid="ask-close"
          className="ml-auto flex size-8 items-center justify-center rounded-full transition hover:bg-accent"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>

      {/* the independently-scrolling thread */}
      <div
        data-testid="ask-thread"
        className="flex max-h-[560px] flex-1 flex-col gap-4 overflow-y-auto px-3 py-3"
      >
        {suggestions.length > 0 && (
          <div data-testid="ask-suggested">
            <p className="text-xs font-medium text-muted-foreground">Try asking</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void ask(s)}
                  className="rounded-full border border-border px-3 py-1.5 text-xs transition hover:bg-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn) => (
          <AskTurnView key={turn.id} turn={turn} onSeek={onSeek} onRetry={() => retry(turn)} />
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
          setInput("");
        }}
        className="flex items-center gap-2 border-t border-border px-3 py-2.5"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={disabled}
          placeholder={disabled ? "AI answers aren't available" : "Ask about this video…"}
          aria-label="Ask a question about this video"
          data-testid="ask-input"
          className="h-9 min-w-0 flex-1 rounded-full border border-border bg-background px-3 text-sm outline-none transition focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled || !input.trim()}
          aria-label="Send question"
          data-testid="ask-submit"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          <SendHorizontal className="size-4" aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}

function AskTurnView({
  turn,
  onSeek,
  onRetry,
}: {
  turn: AskTurn;
  onSeek: (sec: number) => void;
  onRetry: () => void;
}) {
  return (
    <article className="flex flex-col gap-1.5" data-testid="ask-turn">
      <p className="text-sm font-medium" data-testid="ask-turn-question">
        {turn.question}
      </p>
      {turn.status === "loading" && (
        <div className="space-y-1.5" aria-busy="true" aria-label="Thinking">
          <div className="h-4 w-5/6 animate-pulse rounded bg-secondary" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-secondary" />
        </div>
      )}
      {turn.status === "disabled" && (
        <p className="text-sm text-muted-foreground" data-testid="ask-disabled">
          AI answers aren&apos;t available on this deployment.
        </p>
      )}
      {turn.status === "error" && (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-sm text-muted-foreground">{turn.error}</p>
          <button
            type="button"
            data-testid="ask-turn-retry"
            onClick={onRetry}
            className="rounded-full border border-border px-3 py-1 text-sm font-medium transition hover:bg-accent"
          >
            Retry
          </button>
        </div>
      )}
      {turn.status === "ok" && turn.answer && (
        <p className="text-sm leading-relaxed text-foreground/90" data-testid="ask-turn-answer">
          {splitAnswerSegments(turn.answer, { citations: 0, seeks: turn.seeks ?? [] }).map(
            (seg, i) => {
              if (seg.kind === "text") return <span key={i}>{seg.text}</span>;
              if (seg.kind === "seek") {
                return (
                  <button
                    key={i}
                    type="button"
                    data-testid={`ask-seek-${seg.sec}`}
                    onClick={() => onSeek(seg.sec)}
                    aria-label={`Seek to ${seg.label}`}
                    className="mx-0.5 inline-flex h-5 items-center rounded-full bg-secondary px-1.5 align-middle text-xs font-medium tabular-nums text-primary transition hover:bg-accent"
                  >
                    {seg.label}
                  </button>
                );
              }
              return null;
            }
          )}
        </p>
      )}
    </article>
  );
}
