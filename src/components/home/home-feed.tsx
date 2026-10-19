"use client";

import { useSearchParams } from "next/navigation";
import { Flame, Sparkles } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { CategoryChips } from "./category-chips";
import { ContinueWatchingRail, VideoRail } from "./video-rail";
import { ShortsShelf } from "./shorts-shelf";
import { RecommendedGrid, useRecommendedInfiniteScroll } from "./recommended-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { normalizeCategory, HOME_DYNAMIC_CHIPS } from "@/lib/categories";
import type { HomeFeedDTO } from "@/lib/types";

/**
 * The WebFlix home feed (P12-UX: youtube.com parity).
 *
 * Layout — the 2026-10-19 operator directive (the infinite-scroll FEEL):
 * category chips → the first rows of the regular thumbnail grid → the
 * SHORTS SHELF (full-width, horizontal rail, interleaved within the first
 * rows exactly like youtube.com) → the static feature rails
 * (continue-watching, because-you-watched, trending) → THE GROWING GRID —
 * the long-form infinite-scroll feed as the LAST content element, with
 * the sentinel directly beneath it.
 *
 * WHY the growing grid rides last: every section after the feed's growth
 * point re-creates the scroll-up disease the operator reported — appended
 * pages would land above the user's viewport and force them to scroll UP
 * to see the videos they just earned. With all static sections (shorts,
 * rails) rendered BEFORE the growing grid, an appended page extends the
 * bottom of the page itself: new cards appear below the current scroll
 * position, the sentinel keeps chasing the bottom edge, and the feed reads
 * as endless. The load-more skeletons render inside that same last grid,
 * right where the user is looking.
 *
 * The scaffold-era second shorts shelf (parked at the very bottom) is
 * GONE — the interleaved shelf is the one true shelf (youtube.com's own
 * placement, the 2026-10-16 operator pass), and a bottom-parked shelf is
 * exactly the "shorts as the last element" the operator rejected.
 */

/**
 * How many recommended videos render ABOVE the shorts shelf — youtube.com
 * interleaves the shelf within the first two rows of the grid (4-up desktop
 * ≈ 8 videos; on 1-2-up viewports the shelf simply arrives sooner, which is
 * youtube.com's own behavior on narrow layouts).
 */
const SHORTS_SHELF_AFTER = 8;
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

          {/**
           * The interleaved feed: the first rows of long-form videos, the
           * shorts shelf, then the STATIC rails — and the GROWING grid
           * (the rest of the long-form feed, the part infinite scroll
           * appends to) rides LAST, below every static section, with the
           * sentinel directly beneath it (the 2026-10-19 operator
           * directive: appended pages must land BELOW the user's viewport,
           * never above it).
           * A category filter hides the shelf exactly like youtube.com does
           * (shorts shelves only ride the unfiltered home feed).
           */}
          <RecommendedGrid videos={recommendedVideos.slice(0, SHORTS_SHELF_AFTER)} loading={false} />

          {category === "All" && <ShortsShelf shorts={data.shorts} />}

          <ContinueWatchingRail videos={data.continueWatching} />

          {data.becauseYouWatched && data.becauseYouWatched.videos.length > 0 && (
            <VideoRail
              title={`Because you watched ${data.becauseYouWatched.label}`}
              videos={data.becauseYouWatched.videos}
              icon={<Sparkles className="size-5 text-muted-foreground" />}
              railLabel="Because you watched rail"
            />
          )}

          {data.trending.length > 0 && (
            <VideoRail
              title="Trending now"
              videos={data.trending}
              icon={<Flame className="size-5 text-muted-foreground" />}
              moreHref="/trending"
              railLabel="Trending now rail"
            />
          )}

          {/**
           * THE GROWING GRID — the last content element. Appended pages
           * (and their loading skeletons) render here, at the bottom of
           * the page: the infinite-scroll feel the operator asked for.
           * mt-4 keeps the rail rhythm (rail pb-2 + mt-4 + grid pt-2 ≈ the
           * 32px inter-section spacing the rails themselves use).
           */}
          {recommendedVideos.length > SHORTS_SHELF_AFTER && (
            <RecommendedGrid
              videos={recommendedVideos.slice(SHORTS_SHELF_AFTER)}
              loading={loadingMore}
              className="mt-4"
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
  // REA-3 — the dynamic chips (Mixes / Recently uploaded / Live) are feed
  // modes, not upload categories: the honest empty line names the filter,
  // never the "upload the first …" category copy.
  if (HOME_DYNAMIC_CHIPS.includes(category)) {
    return (
      <div className="px-4 py-16 text-center sm:px-6">
        <p className="text-lg font-medium">Nothing in {category} right now</p>
        <p className="mt-1 text-sm text-muted-foreground">
          This filter feeds from YouTube&apos;s live results — check the other chips.
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
