"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useApi } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterPanel, AppliedFilterChips } from "@/components/search/filter-panel";
import { SearchVideoCard } from "@/components/search/search-video-card";
import { useHoverPreview } from "@/components/video/video-hover-preview";
import { ChannelResultCard } from "@/components/search/channel-result-card";
import { PlaylistResultCard } from "@/components/search/playlist-result-card";
import {
  filtersFromParams,
  hasActiveFilters,
  searchHref,
  withGroupValue,
  type SearchFilterState,
} from "@/lib/youtube/search-filters";
import { cn } from "@/lib/utils";
import type { SearchPageDTO, VideoDTO } from "@/lib/types";

/**
 * P13-SEARCH — youtube.com's search results page, feature-for-feature.
 *
 * Live-measured on youtube.com (2026-10-06): a VERTICAL LIST of large
 * horizontal cards (thumbnail 16:9 left — 500px at wide columns, 360px
 * narrower, full-width mobile; metadata right), 16px row gaps, ~1096px
 * centered content column. Channel + playlist cards interleave inline where
 * the API returns them; shorts ride a mid-list shelf. The search box is the
 * TOPBAR's (youtube.com has no second form on the results page — the query
 * lives in the topbar input, prefilled from ?q=).
 *
 * Quick-chip bar (the live 2026 row): All / Videos / Shorts / Recently
 * uploaded / Live — each wired to the existing filter params.
 * WFX2-P6-IS: the results scroll infinitely — the first page rides useApi,
 * every further page rides the opaque ?cursor= with list-shaped skeletons.
 */
export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchContent />
    </Suspense>
  );
}

/** One quick chip in the 2026 row (All / Videos / Shorts / …). */
function QuickChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-9 shrink-0 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors",
        active
          ? "bg-foreground text-background"
          : "bg-secondary text-foreground hover:bg-accent"
      )}
    >
      {label}
    </button>
  );
}

function SearchContent() {
  const params = useSearchParams();
  const router = useRouter();
  const { q, state } = filtersFromParams({
    q: params.get("q"),
    sort: params.get("sort"),
    date: params.get("date") ?? params.get("uploadDate"),
    type: params.get("type"),
    duration: params.get("duration"),
    live: params.get("live"),
    verbatim: params.get("verbatim"),
  });

  const apiHref = q ? withFilterParams(`/api/search`, q, state) : null;
  const { data, loading, error } = useApi<SearchPageDTO>(apiHref);

  // --- WFX2-P6-IS infinite scroll state (mirrors RecommendedGrid) ---------
  const [extra, setExtra] = useState<VideoDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset pagination when the query/filters change (ref-guarded — survives
  // StrictMode double-effects and the compiler's memo analysis).
  const prevHrefRef = useRef<string | null>(apiHref);
  const adoptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (apiHref !== prevHrefRef.current) {
      prevHrefRef.current = apiHref;
      adoptedRef.current = null;
      setExtra([]);
      setCursor(null);
    }
  }, [apiHref]);

  // Adopt the fresh first page's cursor (the cursor state must survive until
  // the chain honestly ends, so it is never derived live from `data`).
  useEffect(() => {
    if (apiHref && data && adoptedRef.current !== apiHref) {
      adoptedRef.current = apiHref;
      setCursor(data.nextCursor ?? null);
    }
  }, [apiHref, data]);

  // The compiler owns memoization here (no manual useCallback): plain
  // function + always-resubscribed observer — idempotent observe, the
  // loadingMore flag dedupes concurrent chain loads.
  async function loadMore() {
    if (!apiHref || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `${apiHref}&cursor=${encodeURIComponent(cursor)}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = (await res.json()) as SearchPageDTO;
      setExtra((prev) => [...prev, ...(page.videos ?? [])]);
      setCursor(page.nextCursor ?? null);
    } catch {
      // Keep the results; the sentinel re-arms and retries on the next pass.
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  });

  // First page + every appended page, deduped by id (server pages are raw —
  // continuation pages can repeat a card; the client owns the dedupe).
  const seenIds = new Set<string>();
  const allVideos = [...(data?.videos ?? []), ...extra].filter((v) => {
    if (seenIds.has(v.id)) return false;
    seenIds.add(v.id);
    return true;
  });

  function pushState(query: string, next: SearchFilterState) {
    router.push(searchHref(query, next));
  }

  function onFiltersChange(next: SearchFilterState) {
    pushState(q, next);
  }

  // --- the quick-chip row (live 2026): each chip = one filter edit ----------
  const chips: { label: string; active: boolean; next: SearchFilterState }[] = [
    {
      label: "All",
      active: !state.type && !state.uploadDate && !state.live,
      next: { ...state, type: undefined, uploadDate: undefined, live: undefined },
    },
    {
      label: "Videos",
      active: state.type === "video",
      next: { ...state, type: "video", uploadDate: undefined, live: undefined },
    },
    {
      label: "Shorts",
      active: state.type === "shorts",
      next: { ...state, type: "shorts", uploadDate: undefined, live: undefined },
    },
    {
      label: "Recently uploaded",
      active: state.uploadDate === "week",
      next: { ...state, type: undefined, uploadDate: "week", live: undefined },
    },
    {
      label: "Live",
      active: state.live === true,
      next: { ...state, type: undefined, uploadDate: undefined, live: true },
    },
  ];

  const shorts = allVideos.filter((v) => v.isShort);
  const videos = allVideos.filter((v) => !v.isShort);
  const channels = data?.channels ?? [];
  const playlists = data?.playlists ?? [];
  const hasAnyResults =
    videos.length > 0 || shorts.length > 0 || channels.length > 0 || playlists.length > 0;

  // --- the interleave (youtube.com's result order: videos with the channel
  // card + shorts shelf + playlist cards inline, never grouped sections) ----
  const headCount = channels.length > 0 ? 2 : videos.length; // channels after ~2 videos
  const head = videos.slice(0, headCount);
  const afterChannels = videos.slice(headCount, headCount + 4);
  const tail = videos.slice(headCount + 4);

  return (
    <div className="mx-auto w-full max-w-[1096px] pb-6">
      {!q && (
        <div className="px-4 py-16 text-center sm:px-6">
          <p className="text-lg font-medium">Search WebFlix</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Find videos and channels — use the search box above.
          </p>
        </div>
      )}

      {q && (
        <>
          {/* the quick-chip row (live 2026 youtube.com) */}
          <div
            role="group"
            aria-label="Quick filters"
            className="flex gap-3 overflow-x-auto px-4 py-3 sm:px-6 slim-scrollbar"
            data-testid="search-quick-chips"
          >
            {chips.map((chip) => (
              <QuickChip
                key={chip.label}
                label={chip.label}
                active={chip.active}
                onClick={() =>
                  pushState(q, chip.active ? { ...state, type: undefined, uploadDate: undefined, live: undefined } : chip.next)
                }
              />
            ))}
          </div>

          {/* results header: count + correction + the Filters button */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 pb-3 sm:px-6">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-normal text-foreground">
                {data?.resultCountText
                  ? data.resultCountText
                  : loading
                    ? "Searching…"
                    : `Results for “${q}”`}
              </h1>
              {data?.correction && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {data.correction.kind === "showingResultsFor" ? (
                    <>
                      Showing results for{" "}
                      <span className="italic">{data.correction.correctedQuery}</span>
                      {" · "}
                      <Link
                        href={searchHref(data.correction.originalQuery ?? q, { verbatim: true })}
                        className="font-medium text-primary underline underline-offset-2"
                      >
                        Search instead for {data.correction.originalQuery}
                      </Link>
                    </>
                  ) : (
                    <Link
                      href={searchHref(data.correction.correctedQuery, {})}
                      className="font-medium text-primary underline underline-offset-2"
                    >
                      Did you mean {data.correction.correctedQuery}?
                    </Link>
                  )}
                </p>
              )}
            </div>
            <FilterPanel state={state} onChange={onFiltersChange} />
          </div>

          {/* applied filter chips */}
          <div className="px-4 py-3 sm:px-6">
            <AppliedFilterChips state={state} onChange={onFiltersChange} />
          </div>

          {loading && (
            <div className="space-y-4 px-4 py-2 sm:px-6" aria-busy="true" data-testid="search-skeleton">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <Skeleton className="aspect-video w-[360px] shrink-0 rounded-xl max-md:w-full" />
                  <div className="hidden flex-1 space-y-3 sm:block">
                    <Skeleton className="h-5 w-5/6" />
                    <Skeleton className="h-5 w-1/2" />
                    <div className="flex items-center gap-2 pt-1">
                      <Skeleton className="size-6 rounded-full" />
                      <Skeleton className="h-3.5 w-32" />
                    </div>
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3.5 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {error && (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground" role="alert">
              {error}
            </p>
          )}
          {data && !hasAnyResults && (
            <div className="mx-auto max-w-md px-4 py-16 text-center sm:px-6">
              {/* P3-SG zero-state parity — youtube.com's no-results copy, honest
                  tips only (every line is a real, applicable suggestion), and the
                  actionable filter removal when filters narrow the results. */}
              <h2 className="text-xl font-semibold">No results found</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Try different keywords or remove search filters.
              </p>
              <ul className="mx-auto mt-6 max-w-sm space-y-2.5 text-left text-sm text-muted-foreground">
                <li>Try more general keywords</li>
                <li>Try fewer keywords</li>
                <li>Check the spelling — or take the “Did you mean” suggestion above</li>
                <li>Remove search filters to widen the results</li>
              </ul>
              {hasActiveFilters(state) && (
                <button
                  type="button"
                  onClick={() => pushState(q, {})}
                  className="mt-6 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
                >
                  Remove all filters
                </button>
              )}
            </div>
          )}

          {/* THE LIST — youtube.com's vertical result list */}
          {data && hasAnyResults && (
            <div className="flex flex-col gap-4 px-4 py-2 sm:px-6" data-testid="search-results-list">
              {head.map((video) => (
                <SearchVideoCard key={video.id} video={video} />
              ))}

              {/* channel cards — inline where the API returns them */}
              {channels.map((ch) => (
                <ChannelResultCard key={ch.id} channel={ch} />
              ))}

              {afterChannels.map((video) => (
                <SearchVideoCard key={video.id} video={video} />
              ))}

              {/* the shorts shelf — inline mid-list (youtube.com's own shape) */}
              {shorts.length > 0 && (
                <section aria-label="Shorts results" className="py-2">
                  <h2 className="pb-3 text-base font-medium text-foreground">Shorts</h2>
                  <div className="-mx-2 flex gap-3 overflow-x-auto px-2 pb-2 slim-scrollbar">
                    {shorts.map((short) => (
                      <SearchShortsTile key={short.id} short={short} />
                    ))}
                  </div>
                </section>
              )}

              {/* playlist cards — inline where the API returns them */}
              {playlists.map((pl) => (
                <PlaylistResultCard key={pl.id} playlist={pl} />
              ))}

              {tail.map((video) => (
                <SearchVideoCard key={video.id} video={video} />
              ))}

              {/* list-shaped skeletons while the cursor chain loads */}
              {loadingMore &&
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={`skeleton-${i}`} className="flex gap-4" aria-hidden="true">
                    <Skeleton className="aspect-video w-[360px] shrink-0 rounded-xl max-md:w-full" />
                    <div className="hidden flex-1 space-y-3 sm:block">
                      <Skeleton className="h-5 w-5/6" />
                      <Skeleton className="h-5 w-1/2" />
                      <Skeleton className="size-6 rounded-full" />
                      <Skeleton className="h-3.5 w-2/3" />
                    </div>
                  </div>
                ))}
            </div>
          )}

          {data && hasAnyResults && cursor && (
            <div
              ref={sentinelRef}
              data-testid="search-scroll-sentinel"
              className="h-1"
              aria-hidden="true"
            />
          )}

          {/* the honest end — the cursor chain ran out after real pages */}
          {data && extra.length > 0 && !cursor && !loadingMore && (
            <p
              data-testid="search-end"
              className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-6"
            >
              No more results — you&apos;ve reached the end
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** /api/search href with the filter query params (mirrors the URL state). */
function withFilterParams(base: string, q: string, state: SearchFilterState): string {
  const params = new URLSearchParams({ q });
  if (state.uploadDate) params.set("date", state.uploadDate);
  if (state.type) params.set("type", state.type);
  if (state.duration) params.set("duration", state.duration);
  if (state.sort && state.sort !== "relevance") params.set("sort", state.sort);
  if (state.live) params.set("live", "1");
  if (state.verbatim) params.set("verbatim", "1");
  return `${base}?${params.toString()}`;
}

/**
 * One shorts tile in the results shelf (P22-A): shorts PLAY ON HOVER now —
 * youtube.com spawns its own muted video preview on these tiles (verified
 * live 2026-10-10) — so the tile rides the SAME useHoverPreview pipeline
 * as every 16:9 card (embed mini player → storyboard → ken-burns). Its own
 * component because each tile needs its own hook instance.
 */
function SearchShortsTile({ short }: { short: VideoDTO }) {
  const hover = useHoverPreview(short);
  return (
    <Link
      href="/shorts"
      className="group flex w-[160px] shrink-0 flex-col gap-2"
      aria-label={short.title}
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
    >
      <div
        data-thumb-anchor=""
        className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-secondary"
      >
        <img
          src={short.thumbnailUrl}
          alt={short.title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform group-hover:scale-105"
        />
      </div>
      <p className="line-clamp-2 text-sm font-medium leading-snug">{short.title}</p>
      <p className="-mt-1 text-xs text-muted-foreground">
        {short.viewsText ?? `${short.views.toLocaleString()} views`}
      </p>
    </Link>
  );
}
