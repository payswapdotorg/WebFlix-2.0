"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Search, X } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { NetflixCard } from "@/components/netflix/netflix-card";
import { cn } from "@/lib/utils";
import type { NetflixSearchResultsDTO, NetflixTitleDTO } from "@/lib/netflix/types";

/**
 * P50 — the in-hub Netflix search page: the search affordance Netflix's own
 * nav has, answered by the same honest mirror the hub browses (Netflix's
 * published Top 10 & Most Popular universe — the scope note rides the DTO,
 * never faked wider).
 *
 * Laws:
 * - the query lives in the URL (`/netflix/search?q=…`) — shareable, and the
 *   input is initialized from it (the YT search page's Netflix shelf and the
 *   topbar suggest both land here with q already set);
 * - debounced live search (300ms) — Netflix's own box searches as you type;
 * - the kind tabs (All / Movies / TV Shows) filter the ANSWERED results
 *   client-side, the same contract as the hub's sub-nav;
 * - honest states only: empty query → the prompt; no results → the honest
 *   empty note; upstream trouble → the DTO's note, never a fake row.
 */

const KIND_TABS = [
  { id: "all", label: "All" },
  { id: "movie", label: "Movies" },
  { id: "series", label: "TV Shows" },
] as const;

type KindTab = (typeof KIND_TABS)[number]["id"];

function SearchContent() {
  const params = useSearchParams();
  const router = useRouter();
  const urlQ = params.get("q") ?? "";

  const [text, setText] = useState(urlQ);
  const [debounced, setDebounced] = useState(urlQ);
  const [kind, setKind] = useState<KindTab>("all");
  const [seenQ, setSeenQ] = useState(urlQ);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommitted = useRef<string>(urlQ);

  // keep the box in sync when the URL changes from OUTSIDE (back/forward,
  // the suggest dropdown, the shelf link) — the render-time adjustment
  // pattern (React's answer to derived-from-props state; no effect cascades)
  if (urlQ !== seenQ) {
    setSeenQ(urlQ);
    setText(urlQ);
    setDebounced(urlQ);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const commit = (next: string) => {
    const q = next.trim();
    if (q === lastCommitted.current) return;
    lastCommitted.current = q;
    setDebounced(q);
    router.replace(q ? `/netflix/search?q=${encodeURIComponent(q)}` : "/netflix/search", {
      scroll: false,
    });
  };

  const onText = (next: string) => {
    setText(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => commit(next), 300);
  };

  const q = debounced.trim();
  const enabled = q.length > 0;
  const { data, loading, error } = useApi<NetflixSearchResultsDTO>(
    enabled ? `/api/netflix/search?q=${encodeURIComponent(q)}` : null
  );

  const titles = useMemo(() => {
    const all = data?.titles ?? [];
    return kind === "all" ? all : all.filter((t) => t.kind === kind);
  }, [data, kind]);

  return (
    <div className="min-h-[70vh] bg-[#0a0a0c] pb-16 text-white">
      <div className="mx-auto max-w-5xl px-4 pt-6 sm:px-6">
        <Link
          href="/netflix"
          className="flex w-fit items-center gap-1.5 text-xs text-white/60 hover:text-white"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Netflix hub
        </Link>

        <h1 className="mt-4 text-xl font-bold sm:text-2xl">Search Netflix</h1>

        {/* the search box — Netflix's own nav affordance */}
        <form
          role="search"
          className="mt-4 flex h-12 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 focus-within:border-white/40"
          data-testid="netflix-search-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (debounceRef.current) clearTimeout(debounceRef.current);
            commit(text);
          }}
        >
          <Search className="size-5 shrink-0 text-white/50" aria-hidden="true" />
          <input
            type="search"
            value={text}
            onChange={(e) => onText(e.target.value)}
            placeholder="Titles in Netflix's Top 10 & Most Popular universe…"
            aria-label="Search Netflix titles"
            data-testid="netflix-search-input"
            className="h-full w-full bg-transparent text-sm outline-none placeholder:text-white/35 sm:text-base"
            autoFocus
          />
          {text && (
            <button
              type="button"
              aria-label="Clear the search"
              data-testid="netflix-search-clear"
              onClick={() => {
                setText("");
                if (debounceRef.current) clearTimeout(debounceRef.current);
                commit("");
              }}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
        </form>

        {/* the kind tabs — the hub sub-nav's contract, over the answered set */}
        {enabled && (
          <nav
            role="group"
            aria-label="Results filter"
            className="mt-4 flex gap-1"
            data-testid="netflix-search-kind-tabs"
          >
            {KIND_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={kind === t.id}
                onClick={() => setKind(t.id)}
                className={cn(
                  "h-8 rounded px-3.5 text-sm font-medium transition-colors",
                  kind === t.id ? "bg-white text-black" : "text-white/70 hover:text-white"
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}
      </div>

      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        {!enabled && (
          <div className="py-16 text-center" data-testid="netflix-search-prompt">
            <p className="text-sm text-white/60">
              Search the titles Netflix itself publishes for tracking — the weekly Top 10
              films and series plus the all-time Most Popular lists.
            </p>
            <p className="mt-2 text-xs text-white/40">
              Try “Doing Life”, “Us”, or anything you saw on the hub.
            </p>
          </div>
        )}

        {enabled && error && (
          <p role="alert" className="py-12 text-center text-sm text-white/60" data-testid="netflix-search-error">
            {error} — the search retries on the next keystroke.
          </p>
        )}

        {enabled && loading && (
          <div aria-busy="true" data-testid="netflix-search-skeleton">
            <div className="mt-8 flex flex-wrap justify-center gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="aspect-video w-[200px] rounded-lg bg-white/5 sm:w-[232px]" />
              ))}
            </div>
          </div>
        )}

        {enabled && !loading && !error && (
          <>
            {data?.note && (
              <p className="mt-6 text-xs text-white/40" data-testid="netflix-search-note">
                {data.note}
              </p>
            )}
            {titles.length > 0 ? (
              <>
                <p className="mt-2 text-xs text-white/50" data-testid="netflix-search-count">
                  {titles.length} {titles.length === 1 ? "title" : "titles"}
                </p>
                <div
                  className="mt-3 flex flex-wrap justify-center gap-4 pb-2"
                  data-testid="netflix-search-results"
                >
                  {titles.map((t: NetflixTitleDTO) => (
                    <NetflixCard key={t.netflixId} title={t} />
                  ))}
                </div>
              </>
            ) : (
              <div className="py-12 text-center" data-testid="netflix-search-empty">
                <p className="text-sm font-medium text-white/80">
                  No matches for “{q}” in the tracked universe
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm text-white/50">
                  WebFlix searches Netflix&apos;s own published Top 10 &amp; Most Popular
                  lists — not every Netflix title. What&apos;s tracking today is on the{" "}
                  <Link href="/netflix" className="underline underline-offset-2 hover:text-white/70">
                    hub
                  </Link>
                  , and the full catalog lives on{" "}
                  <Link href="/netflix/watch/live" className="underline underline-offset-2 hover:text-white/70">
                    Netflix Live
                  </Link>
                  .
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function NetflixSearchView() {
  return (
    <Suspense fallback={null}>
      <SearchContent />
    </Suspense>
  );
}
