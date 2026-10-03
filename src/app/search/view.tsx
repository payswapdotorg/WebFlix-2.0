"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { VideoCard } from "@/components/video/video-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterPanel, AppliedFilterChips } from "@/components/search/filter-panel";
import { ChannelResultCard } from "@/components/search/channel-result-card";
import { PlaylistResultCard } from "@/components/search/playlist-result-card";
import {
  filtersFromParams,
  hasActiveFilters,
  searchHref,
  type SearchFilterState,
} from "@/lib/youtube/search-filters";
import { formatCount } from "@/lib/format";
import type { SearchPageDTO, VideoDTO } from "@/lib/types";

/**
 * Search — live youtube.com search with the real filter semantics
 * (WFX2-B-W): URL-synced filters (?q=&sort=&date=&type=&duration= —
 * shareable), applied-filter chips, result-count text, spelling correction
 * ("Showing results for … / Search instead for …"), channel-result cards
 * with Subscribe, playlist-result cards, shorts lockups.
 * WFX2-P6-IS: the results scroll infinitely — the first page rides useApi,
 * every further page rides the opaque ?cursor= (the RecommendedGrid house
 * pattern: IntersectionObserver sentinel, append + dedupe by id, skeletons,
 * and the honest end state when the cursor chain runs out).
 */
export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchContent />
    </Suspense>
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
    verbatim: params.get("verbatim"),
  });
  const [input, setInput] = useState(q);

  const apiHref = q ? withFilterParams(`/api/search`, q, state) : null;
  const { data, loading, error } = useApi<SearchPageDTO>(apiHref);

  // --- WFX2-P6-IS infinite scroll state (mirrors RecommendedGrid) ---------
  const [extra, setExtra] = useState<VideoDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset pagination when the query/filters change (guarded render-phase reset).
  const [prevHref, setPrevHref] = useState(apiHref);
  if (apiHref !== prevHref) {
    setPrevHref(apiHref);
    setExtra([]);
    setCursor(null);
  }

  // Adopt the fresh first page's cursor (guarded render-phase reset — the
  // cursor state must survive until the chain honestly ends, so it is never
  // derived live from `data`).
  const [adoptedHref, setAdoptedHref] = useState<string | null>(null);
  if (apiHref && data && adoptedHref !== apiHref) {
    setAdoptedHref(apiHref);
    setCursor(data.nextCursor ?? null);
  }

  const loadMore = useCallback(async () => {
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
  }, [apiHref, cursor, loadingMore]);

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
  }, [loadMore]);

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

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const query = input.trim();
    if (query) pushState(query, { ...state, verbatim: undefined });
  }

  function onFiltersChange(next: SearchFilterState) {
    pushState(q, next);
  }

  const shorts = allVideos.filter((v) => v.isShort);
  const videos = allVideos.filter((v) => !v.isShort);
  const hasAnyResults =
    (data?.videos.length ?? 0) > 0 ||
    (data?.channels.length ?? 0) > 0 ||
    (data?.playlists?.length ?? 0) > 0;

  return (
    <div className="pb-6">
      <form role="search" onSubmit={submit} className="flex gap-2 px-4 py-4 sm:px-6">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search WebFlix"
            aria-label="Search WebFlix"
            className="rounded-full pl-10"
            autoFocus
          />
          {input && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setInput("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <Button type="submit" variant="secondary" className="rounded-full">
          Search
        </Button>
      </form>

      {!q && (
        <div className="px-4 py-16 text-center sm:px-6">
          <p className="text-lg font-medium">Search WebFlix</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Find videos and channels — try “blender”, “elden ring” or “travel”.
          </p>
        </div>
      )}

      {q && (
        <>
          {/* results header: count + correction + the Filters button */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 pb-3 sm:px-6">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-medium text-foreground sm:text-base">
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
            <div className="space-y-6 px-4 sm:px-6" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <Skeleton className="aspect-video w-[240px] shrink-0 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-3.5 w-1/3" />
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-6 rounded-full"
                  onClick={() => pushState(q, {})}
                >
                  Remove all filters
                </Button>
              )}
            </div>
          )}

          {/* channel result cards */}
          {data && data.channels.length > 0 && (
            <section aria-label="Channel results" className="px-4 pb-4 pt-2 sm:px-6">
              {state.type !== "channel" && (
                <h2 className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Channels
                </h2>
              )}
              {data.channels.map((ch) => (
                <ChannelResultCard key={ch.id} channel={ch} />
              ))}
            </section>
          )}

          {/* playlist result cards */}
          {data && (data.playlists?.length ?? 0) > 0 && (
            <section aria-label="Playlist results" className="px-4 pb-4 sm:px-6">
              {state.type !== "playlist" && (
                <h2 className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Playlists
                </h2>
              )}
              {data.playlists?.map((pl) => <PlaylistResultCard key={pl.id} playlist={pl} />)}
            </section>
          )}

          {/* shorts lockups */}
          {data && shorts.length > 0 && (
            <section aria-label="Shorts results" className="px-4 pb-6 pt-2 sm:px-6">
              <h2 className="pb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Shorts
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                {shorts.map((short) => (
                  <Link
                    key={short.id}
                    href="/shorts"
                    className="group flex flex-col gap-2"
                    aria-label={short.title}
                  >
                    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-secondary">
                      <img
                        src={short.thumbnailUrl}
                        alt={short.title}
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    </div>
                    <p className="line-clamp-2 text-sm font-medium leading-snug">{short.title}</p>
                    <p className="-mt-1 text-xs text-muted-foreground">
                      {formatCount(short.views)} views
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* video results */}
          {data && videos.length > 0 && (
            <section aria-label="Video results" className="px-4 sm:px-6">
              {state.type !== "video" && videos.length > 0 && (
                <h2 className="pb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Videos
                </h2>
              )}
              <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {videos.map((video) => (
                  <VideoCard key={video.id} video={video} />
                ))}
                {loadingMore &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={`skeleton-${i}`} className="flex flex-col gap-3" aria-hidden="true">
                      <Skeleton className="aspect-video w-full rounded-xl" />
                      <div className="flex gap-3">
                        <Skeleton className="size-9 rounded-full" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-full" />
                          <Skeleton className="h-3 w-2/3" />
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
              {cursor && (
                <div
                  ref={sentinelRef}
                  data-testid="search-scroll-sentinel"
                  className="h-1"
                  aria-hidden="true"
                />
              )}
            </section>
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
  if (state.verbatim) params.set("verbatim", "1");
  return `${base}?${params.toString()}`;
}
