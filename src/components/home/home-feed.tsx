"use client";

import { useSearchParams } from "next/navigation";
import { Flame, Sparkles } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { CategoryChips } from "./category-chips";
import { ContinueWatchingRail, VideoRail } from "./video-rail";
import { ShortsShelf } from "./shorts-shelf";
import { RecommendedGrid, useRecommendedInfiniteScroll } from "./recommended-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { normalizeCategory } from "@/lib/categories";
import type { HomeFeedDTO } from "@/lib/types";

/**
 * The WebFlix home feed (P12-UX: youtube.com parity).
 *
 * Layout — exactly youtube.com's home shape: category chips → the regular
 * thumbnail grid from the FIRST row (the giant "Trending #1" hero and its
 * side list are gone), then the feature rails (continue-watching,
 * because-you-watched) with FULL-SIZE cards, the shorts shelf inline, and
 * the demoted trending rail (the old hero's trending surface folded into
 * it — nothing data-driven was deleted). The infinite-scroll sentinel
 * renders at the very END of the feed so appended grid pages never push
 * the rails away mid-scroll.
 */
export function HomeFeed() {
  const params = useSearchParams();
  const category = normalizeCategory(params.get("category"));
  const { data, loading, error, reload } = useApi<HomeFeedDTO>(
    `/api/home?category=${encodeURIComponent(category)}`
  );
  // Destructure once: plain bindings for the render values, the ref itself
  // only ever handed to the sentinel's `ref` (react-hooks/refs law).
  const {
    videos: recommendedVideos,
    cursor: recommendedCursor,
    loading: loadingMore,
    sentinelRef,
  } = useRecommendedInfiniteScroll(data?.recommended, data?.recommendedCursor ?? null, category);

  return (
    <div className="pb-4">
      <CategoryChips chips={data?.chips ?? ["All"]} active={category} />
      {loading && <HomeSkeleton />}
      {error && (
        <div className="px-4 py-16 text-center sm:px-6" role="alert">
          <p className="text-lg font-medium text-foreground">Something went wrong</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={reload}
            className="mt-4 rounded-full bg-secondary px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            Try again
          </button>
        </div>
      )}
      {data && (
        <>
          {data.trending.length === 0 &&
            data.continueWatching.length === 0 &&
            (data.becauseYouWatched?.videos.length ?? 0) === 0 &&
            data.shorts.length === 0 &&
            data.recommended.length === 0 && <CategoryEmptyState category={category} />}

          <RecommendedGrid videos={recommendedVideos} loading={loadingMore} />

          <ContinueWatchingRail videos={data.continueWatching} />

          {data.becauseYouWatched && data.becauseYouWatched.videos.length > 0 && (
            <VideoRail
              title={`Because you watched ${data.becauseYouWatched.label}`}
              videos={data.becauseYouWatched.videos}
              icon={<Sparkles className="size-5 text-muted-foreground" />}
              railLabel="Because you watched rail"
            />
          )}

          <ShortsShelf shorts={data.shorts} />

          {data.trending.length > 0 && (
            <VideoRail
              title="Trending now"
              videos={data.trending}
              icon={<Flame className="size-5 text-muted-foreground" />}
              moreHref="/trending"
              railLabel="Trending now rail"
            />
          )}

          {recommendedCursor && (
            <div
              ref={sentinelRef}
              data-testid="infinite-scroll-sentinel"
              className="h-1"
              aria-hidden="true"
            />
          )}
        </>
      )}
    </div>
  );
}

function CategoryEmptyState({ category }: { category: string }) {
  if (category === "All") {
    return (
      <div className="px-4 py-16 text-center sm:px-6">
        <p className="text-lg font-medium">No feed yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          YouTube&apos;s home feed needs a session — search for anything in the meantime.
        </p>
      </div>
    );
  }
  return (
    <div className="px-4 py-16 text-center sm:px-6">
      <p className="text-lg font-medium">Nothing in {category} yet</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Check the other categories — or upload the first {category.toLowerCase()} video.
      </p>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="px-4 pb-8 pt-2 sm:px-6" aria-busy="true" aria-label="Loading home feed">
      <div className="grid grid-cols-1 gap-x-4 gap-y-9 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <div className="flex gap-3">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
