"use client";

import { Suspense, useState } from "react";
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
  searchHref,
  type SearchFilterState,
} from "@/lib/youtube/search-filters";
import { formatCount } from "@/lib/format";
import type { SearchPageDTO } from "@/lib/types";

/**
 * Search — live youtube.com search with the real filter semantics
 * (WFX2-B-W): URL-synced filters (?q=&sort=&date=&type=&duration= —
 * shareable), applied-filter chips, result-count text, spelling correction
 * ("Showing results for … / Search instead for …"), channel-result cards
 * with Subscribe, playlist-result cards, shorts lockups.
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

  const shorts = data?.videos.filter((v) => v.isShort) ?? [];
  const videos = data?.videos.filter((v) => !v.isShort) ?? [];
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
            <div className="px-4 py-16 text-center sm:px-6">
              <p className="text-lg font-medium">No results for “{q}”</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try different keywords or removing some filters — WebFlix searches all of YouTube.
              </p>
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
              </div>
            </section>
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
