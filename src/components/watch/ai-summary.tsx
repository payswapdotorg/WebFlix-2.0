"use client";

/**
 * P23-B (G4) — the AI summary block on the watch page (above the
 * description): a grounded 3-5 sentence summary + chapters-aware Key
 * moments. The moments' timestamps are the REAL chapter starts (validated
 * server-side — fabricated ones are dropped before they ever render); a
 * chip click seeks the player there.
 *
 * Honest degradation: {status:"disabled"} (no ZAI_API_KEY) → the block stays
 * HIDDEN; failures → the honest error + Retry; a video without chapters →
 * the summary renders, the Key moments row honestly doesn't.
 *
 * State shape: the last result is keyed by its request key — "loading" is
 * simply the absence of a result for the CURRENT key (video/retry), so no
 * state is ever set synchronously inside an effect.
 */
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import type { KeyMoment, WatchSummaryResponse } from "@/lib/ai/heuristic";

interface SummaryState {
  key: string;
  phase: "ok" | "error" | "hidden";
  summary: string;
  moments: KeyMoment[];
  error: string | null;
}

export function AiSummary({ videoId, onSeek }: { videoId: string; onSeek: (sec: number) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<SummaryState | null>(null);

  const key = `${videoId}|${reloadKey}`;
  // loading = no result yet for the CURRENT key (stale results never render)
  const current = state?.key === key ? state : null;
  const phase = current?.phase ?? "loading";
  const summary = current?.phase === "ok" ? current.summary : "";
  const moments = current?.phase === "ok" ? current.moments : [];
  const error = current?.phase === "error" ? current.error : null;

  useEffect(() => {
    let alive = true;
    fetch(`/api/videos/${encodeURIComponent(videoId)}/summary`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as WatchSummaryResponse & {
          error?: string;
        };
        if (!alive) return;
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        if (body.status === "disabled") {
          setState({ key, phase: "hidden", summary: "", moments: [], error: null });
          return;
        }
        setState({
          key,
          phase: "ok",
          summary: body.status === "ok" ? body.summary : "",
          moments: body.status === "ok" ? body.keyMoments : [],
          error: null,
        });
      })
      .catch((e) => {
        if (!alive) return;
        setState({
          key,
          phase: "error",
          summary: "",
          moments: [],
          error: e instanceof Error ? e.message : "The AI summary failed",
        });
      });
    return () => {
      alive = false;
    };
  }, [videoId, key]);

  if (phase === "hidden") return null;

  return (
    <section
      aria-label="AI summary"
      data-testid="ai-summary"
      className="mt-3 overflow-hidden rounded-xl border border-border bg-card/40"
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <Sparkles className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold">AI summary</h2>
        <span className="hidden text-xs text-muted-foreground sm:inline">AI-generated</span>
        <button
          type="button"
          data-testid="ai-summary-collapse"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand the AI summary" : "Collapse the AI summary"}
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
            <div className="space-y-2" aria-busy="true" aria-label="Loading the AI summary">
              <div className="h-4 w-11/12 animate-pulse rounded bg-secondary" />
              <div className="h-4 w-4/5 animate-pulse rounded bg-secondary" />
            </div>
          )}

          {phase === "error" && (
            <div className="flex flex-wrap items-center gap-3" role="alert">
              <p className="text-sm text-muted-foreground">
                {error ?? "The AI summary failed."}
              </p>
              <button
                type="button"
                data-testid="ai-summary-retry"
                onClick={() => setReloadKey((k) => k + 1)}
                className="rounded-full border border-border px-3 py-1 text-sm font-medium transition hover:bg-accent"
              >
                Retry
              </button>
            </div>
          )}

          {phase === "ok" && (
            <>
              <p className="text-sm leading-relaxed" data-testid="ai-summary-text">
                {summary}
              </p>
              {moments.length > 0 && (
                <div className="mt-3" data-testid="key-moments">
                  <p className="text-xs font-medium text-muted-foreground">Key moments</p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {moments.map((m) => (
                      <button
                        key={m.sec}
                        type="button"
                        data-testid={`key-moment-${m.sec}`}
                        onClick={() => onSeek(m.sec)}
                        aria-label={`Seek to ${m.label} — ${m.title}`}
                        className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1.5 text-xs transition hover:bg-accent"
                      >
                        <span className="font-medium tabular-nums text-primary">{m.label}</span>
                        <span className="max-w-[220px] truncate text-muted-foreground">
                          {m.title}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
