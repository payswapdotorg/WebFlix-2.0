"use client";

import { useSearchParams } from "next/navigation";
import { useApi } from "@/hooks/use-api";
import { CategoryChips } from "./category-chips";
import { ContinueWatchingRail } from "./video-rail";
import { ShortsShelf } from "./shorts-shelf";
import { RecommendedGrid, useRecommendedInfiniteScroll } from "./recommended-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { normalizeCategory, HOME_DYNAMIC_CHIPS } from "@/lib/categories";
import type { HomeFeedDTO } from "@/lib/types";

/**
 * The WebFlix home feed (P12-UX → P27 → P30).
 *
 * Layout — the 2026-10-20 operator directive (verbatim):
 *   "the home page should be:
 *    one row of long format video boxes
 *    one row of long format video boxes
 *    one row of short video boxes
 *    one row of long format video boxes
 *    one row of short video boxes
 *    one row of long format video boxes
 *    one row of long format video boxes
 *    one row of continue watching
 *    one row of long format video boxes
 *    ... (infinite scrolling)"
 *
 * With the 3-up grid (the same directive: "the long format video boxes need
 * to be bigger such that 3 fit in one row") that is 3+3 long → shorts → 3
 * long → shorts → 3+3 long → continue-watching → THE GROWING GRID (the
 * long-form infinite-scroll feed) as the LAST content element with the
 * sentinel directly beneath — the two operator laws held together: the
 * interleaved shorts rhythm AND the infinite-scroll feel (appended pages
 * land BELOW the user's viewport, never above it — the P27 directive
 * stands).
 *
 * The two shorts rows split the feed's short deck across the two shelves
 * (first half / second half) — never the same tiles twice (the duplicate
 * shelf disease the P27 pass killed stays dead). A category filter hides
 * both shelves exactly like youtube.com (shorts ride the unfiltered home
 * only), which collapses the pattern to one 15-card opening grid.
 *
 * The because-you-watched and trending rails are GONE from the home page —
 * the operator's explicit home composition has neither, and neither does
 * youtube.com's own home (trending keeps its own destination at /trending;
 * the /api/home DTO still carries both fields for other consumers).
 */

/**
 * The interleaved pattern's growth points (3-up rows): rows 1-2 above the
 * first shorts shelf, one row between the shelves, rows 6-7 below the
 * second — 5 long rows (15 cards) before the continue-watching rail.
 */
const FIRST_BLOCK_END = 6;
const MID_BLOCK_END = 9;
const LAST_BLOCK_END = 15;

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

  // The operator's two shorts rows: the short deck splits at its midpoint
  // (12 shorts → 6 + 6), so the second row shows NEW tiles, never a repeat.
  const showShorts = category === "All";
  const shortsMid = Math.ceil((data?.shorts.length ?? 0) / 2);
  const firstShorts = showShorts ? (data?.shorts.slice(0, shortsMid) ?? []) : [];
  const secondShorts = showShorts ? (data?.shorts.slice(shortsMid) ?? []) : [];

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
          {data.recommended.length === 0 &&
            data.continueWatching.length === 0 &&
            (!showShorts || data.shorts.length === 0) && <CategoryEmptyState category={category} />}

          {/**
           * THE INTERLEAVED OPENING (the operator's exact row pattern):
           * long rows 1-2 → SHORTS row 3 → long row 4 → SHORTS row 5 →
           * long rows 6-7 → the continue-watching rail (row 8). On a
           * category-filtered feed both shorts shelves hide (youtube.com's
           * own law) and the five long rows render as one opening grid.
           */}
          {showShorts ? (
            <>
              <RecommendedGrid
                videos={recommendedVideos.slice(0, FIRST_BLOCK_END)}
                loading={false}
              />
              <ShortsShelf shorts={firstShorts} />
              <RecommendedGrid
                videos={recommendedVideos.slice(FIRST_BLOCK_END, MID_BLOCK_END)}
                loading={false}
                className="mt-2"
              />
              <ShortsShelf shorts={secondShorts} />
              <RecommendedGrid
                videos={recommendedVideos.slice(MID_BLOCK_END, LAST_BLOCK_END)}
                loading={false}
                className="mt-2"
              />
            </>
          ) : (
            <RecommendedGrid
              videos={recommendedVideos.slice(0, LAST_BLOCK_END)}
              loading={false}
            />
          )}

          {/**
           * Row 8 — the continue-watching rail (the one static rail left on
           * the home page: the operator's composition keeps it between the
           * opening rows and the growing grid; it renders only with real
           * history).
           */}
          <ContinueWatchingRail videos={data.continueWatching} />

          {/**
           * THE GROWING GRID — the last content element (row 9 onward,
           * "… (infinite scrolling)"). Appended pages (and their loading
           * skeletons) render here, at the bottom of the page: new cards
           * land below the user's viewport and the sentinel keeps chasing
           * the bottom edge — the P27 law, unchanged.
           */}
          {recommendedVideos.length > LAST_BLOCK_END && (
            <RecommendedGrid
              videos={recommendedVideos.slice(LAST_BLOCK_END)}
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
      {/* The 3-up opening rows (the P30 density: bigger boxes, 3 per row). */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 9 }).map((_, i) => (
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
      {/* the shorts row skeleton (9:16 tiles) */}
      <div className="no-scrollbar mt-6 flex gap-4 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[9/16] w-[168px] shrink-0 rounded-xl sm:w-[192px]" />
        ))}
      </div>
    </div>
  );
}
