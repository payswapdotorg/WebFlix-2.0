"use client";

/**
 * P23-B (G3) — the search AI answer card (youtube.com's 2026 "Ask" family).
 *
 * Fires only for conversational queries (the heuristic lives in
 * @/lib/ai/heuristic) and mounts ABOVE the results grid, on the same query
 * the grid renders — the citations [n] map to the top result cards below.
 *
 * Honest degradation family:
 *  - {status:"disabled"} (no ZAI_API_KEY) → the card stays HIDDEN (an
 *    honest absence, never a fake answer);
 *  - {status:"no-results"} → hidden (the grid's own zero-state speaks);
 *  - failure → the honest error + Retry.
 * The answer reveals with a type-out animation (instant under
 * prefers-reduced-motion) and collapses behind the header.
 *
 * State shape: the last result is keyed by its request key — "loading" is
 * simply the absence of a result for the CURRENT key (query/filters/retry),
 * so no state is ever set synchronously inside an effect.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { postJson } from "@/hooks/use-api";
import {
  splitAnswerSegments,
  type AskCitation,
  type SearchAskResponse,
} from "@/lib/ai/heuristic";
import type { SearchFilterState } from "@/lib/youtube/search-filters";

const TYPEOUT_TICK_MS = 24;
const TYPEOUT_STEPS = 24;

interface AskState {
  key: string;
  phase: "ok" | "error" | "hidden";
  answer: string;
  citations: AskCitation[];
  error: string | null;
}

export function SearchAskCard({ query, filters }: { query: string; filters: SearchFilterState }) {
  const [collapsed, setCollapsed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [shown, setShown] = useState(0);
  const [state, setState] = useState<AskState | null>(null);

  const filterKey = JSON.stringify(filters);
  const key = `${query}|${filterKey}|${reloadKey}`;
  // loading = no result yet for the CURRENT key (stale results never render)
  const current = state?.key === key ? state : null;
  const phase = current?.phase ?? "loading";
  const answer = current?.phase === "ok" ? current.answer : "";
  const citations = current?.phase === "ok" ? current.citations : [];
  const error = current?.phase === "error" ? current.error : null;

  useEffect(() => {
    let alive = true;
    postJson<SearchAskResponse>("/api/search/ask", {
      q: query,
      filters: JSON.parse(filterKey) as SearchFilterState,
    })
      .then((r) => {
        if (!alive) return;
        setShown(0);
        if (r.status === "ok") {
          setState({ key, phase: "ok", answer: r.answer, citations: r.citations, error: null });
        } else {
          // disabled (no key) + no-results — the honest hidden states
          setState({ key, phase: "hidden", answer: "", citations: [], error: null });
        }
      })
      .catch((e) => {
        if (!alive) return;
        setState({
          key,
          phase: "error",
          answer: "",
          citations: [],
          error: e instanceof Error ? e.message : "The AI answer failed",
        });
      });
    return () => {
      alive = false;
    };
  }, [query, filterKey, key]);

  // the type-out reveal — restarts on answer change; instant for reduced
  // motion (the reset rides the async fetch path, never the effect body)
  useEffect(() => {
    if (phase !== "ok" || !answer) return;
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      const t = setTimeout(() => setShown(answer.length), 0);
      return () => clearTimeout(t);
    }
    const perTick = Math.max(1, Math.ceil(answer.length / TYPEOUT_STEPS));
    const timer = setInterval(() => {
      setShown((c) => {
        const next = Math.min(answer.length, c + perTick);
        if (next >= answer.length) clearInterval(timer);
        return next;
      });
    }, TYPEOUT_TICK_MS);
    return () => clearInterval(timer);
  }, [answer, phase]);

  const segments = useMemo(
    () => (phase === "ok" ? splitAnswerSegments(answer, { citations: citations.length, seeks: [] }) : []),
    [answer, phase, citations.length]
  );

  if (phase === "hidden") return null;

  return (
    <section
      aria-label="AI answer"
      data-testid="ask-answer-card"
      className="overflow-hidden rounded-xl border border-border bg-card/40"
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <Sparkles className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold">AI answer</h2>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          AI-generated — check the sources
        </span>
        <button
          type="button"
          data-testid="ask-collapse"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand the AI answer" : "Collapse the AI answer"}
          className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-full transition hover:bg-accent"
        >
          {collapsed ? (
            <ChevronDown className="size-4" aria-hidden="true" />
          ) : (
            <ChevronUp className="size-4" aria-hidden="true" />
          )}
        </button>
      </header>

      {!collapsed && (
        <div className="border-t border-border px-4 py-3">
          {phase === "loading" && (
            <div className="space-y-2" aria-busy="true" aria-label="Thinking" data-testid="ask-loading">
              <div className="h-4 w-11/12 animate-pulse rounded bg-secondary" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-secondary" />
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-wrap items-center gap-3" role="alert">
              <p className="text-sm text-muted-foreground">
                {error ?? "The AI answer failed."}
              </p>
              <button
                type="button"
                data-testid="ask-retry"
                onClick={() => setReloadKey((k) => k + 1)}
                className="rounded-full border border-border px-3 py-1 text-sm font-medium transition hover:bg-accent"
              >
                Retry
              </button>
            </div>
          )}

          {phase === "ok" && (
            <>
              <p className="text-sm leading-relaxed" data-testid="ask-answer-text">
                {segments.map((seg, i) => {
                  if (seg.kind === "text") {
                    const text = answer.slice(
                      seg.start,
                      Math.min(seg.start + seg.text.length, shown)
                    );
                    return <span key={i}>{text}</span>;
                  }
                  if (seg.start >= shown) return null;
                  if (seg.kind === "citation") {
                    const c = citations[seg.n - 1];
                    return (
                      <Link
                        key={i}
                        href={`/watch/${c.videoId}`}
                        data-testid={`ask-citation-${seg.n}`}
                        aria-label={`Source ${seg.n}: ${c.title} by ${c.channelName}`}
                        className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary px-1.5 align-middle text-xs font-medium tabular-nums transition hover:bg-accent"
                      >
                        {seg.n}
                      </Link>
                    );
                  }
                  return null;
                })}
              </p>

              {citations.length > 0 && (
                <div
                  className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2"
                  data-testid="ask-sources"
                >
                  {citations.map((c) => (
                    <Link
                      key={c.n}
                      href={`/watch/${c.videoId}`}
                      className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
                    >
                      <span className="shrink-0 tabular-nums">[{c.n}]</span>
                      <span className="max-w-[220px] truncate">
                        {c.title} · {c.channelName}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
