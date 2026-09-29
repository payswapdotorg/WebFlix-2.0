"use client";

import { useSearchParams } from "next/navigation";
import { Flame, Sparkles } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { CategoryChips } from "./category-chips";
import { HeroCard } from "./hero-card";
import { TrendingSideList } from "./trending-side-list";
import { ContinueWatchingRail, VideoRail } from "./video-rail";
import { ShortsShelf } from "./shorts-shelf";
import { RecommendedGrid } from "./recommended-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { normalizeCategory } from "@/lib/categories";
import type { HomeFeedDTO } from "@/lib/types";

/** The WebFlix home feed — every rail comes from GET /api/home (real DB). */
export function HomeFeed() {
  const params = useSearchParams();
  const category = normalizeCategory(params.get("category"));
  const { data, loading, error, reload } = useApi<HomeFeedDTO>(
    `/api/home?category=${encodeURIComponent(category)}`
  );

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
          {data.hero && (
            <div className="grid gap-4 px-4 sm:px-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <HeroCard video={data.hero} />
              <TrendingSideList videos={data.trending.slice(0, 4)} />
            </div>
          )}
          {!data.hero &&
            data.trending.length === 0 &&
            data.continueWatching.length === 0 &&
            (data.becauseYouWatched?.videos.length ?? 0) === 0 &&
            data.shorts.length === 0 &&
            data.recommended.length === 0 && <CategoryEmptyState category={category} />}

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

          {data.trending.length > 4 && (
            <VideoRail
              title="Trending now"
              videos={data.trending.slice(4)}
              icon={<Flame className="size-5 text-muted-foreground" />}
              moreHref="/trending"
              railLabel="Trending now rail"
            />
          )}

          <RecommendedGrid
            initialVideos={data.recommended}
            initialCursor={data.recommendedCursor}
            category={category}
          />
        </>
      )}
    </div>
  );
}

function CategoryEmptyState({ category }: { category: string }) {
  if (category === "All") {
    return (
      <div className="px-4 py-16 text-center sm:px-6">
        <p className="text-lg font-medium">No videos yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The database is empty — run <code className="rounded bg-secondary px-1">bun run db:seed</code>.
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
    <div className="space-y-6" aria-busy="true" aria-label="Loading home feed">
      <Skeleton className="mx-4 aspect-video max-h-[420px] w-[calc(100%-2rem)] rounded-2xl sm:mx-6 sm:w-[calc(100%-3rem)]" />
      {Array.from({ length: 2 }).map((_, r) => (
        <div key={r} className="px-4 sm:px-6">
          <Skeleton className="h-6 w-48" />
          <div className="mt-3 flex gap-4 overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="w-[240px] shrink-0 space-y-3">
                <Skeleton className="aspect-video w-full rounded-xl" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
