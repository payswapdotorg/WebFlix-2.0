"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ChefHat,
  Clapperboard,
  Code,
  Compass,
  Cpu,
  Disc3,
  Dumbbell,
  Gamepad2,
  GraduationCap,
  Mic,
  Music,
  Newspaper,
  Plane,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import { HOME_CHIPS, categoryDestination } from "@/lib/categories";
import { cn } from "@/lib/utils";
import type { ExploreCategoryPageDTO, VideoDTO } from "@/lib/types";

/** The category icon set (the explore hub's own icon table, rendered). */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Music,
  Gaming: Gamepad2,
  News: Newspaper,
  Sports: Trophy,
  Coding: Code,
  Tech: Cpu,
  Education: GraduationCap,
  Travel: Plane,
  Cooking: ChefHat,
  Fitness: Dumbbell,
  Comedy: Clapperboard,
  Mixes: Disc3,
  Podcasts: Mic,
};

/**
 * The explore category browse page (WFX2-P19-EXPL) — youtube.com's category
 * layout: the chip row (All + the 14 categories, URL-synced via Link like
 * trending's chips — never client state), then a ranked grid of real videos
 * composed from per-category seed searches. Infinite scroll rides the opaque
 * cursor envelopes (the search view's sentinel pattern); in public mode (no
 * operator YouTube session) the honest degradation banner says what composed
 * the grid — YouTube's own signed-in category browse is session-walled.
 */
export default function ExploreCategoryPage({ category }: { category: string }) {
  const apiHref = `/api/explore/category?key=${encodeURIComponent(category)}`;
  const { data, loading, error } = useApi<ExploreCategoryPageDTO>(apiHref);

  // --- infinite scroll state (mirrors the search view) ---------------------
  const [extra, setExtra] = useState<VideoDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset pagination when the category changes (the same page component
  // serves every /explore/category/[key] — ref-guarded so it survives
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
    if (data && adoptedRef.current !== apiHref) {
      adoptedRef.current = apiHref;
      setCursor(data.nextCursor ?? null);
    }
  }, [apiHref, data]);

  // The compiler owns memoization here (no manual useCallback): plain
  // function + always-resubscribed observer — idempotent observe, the
  // loadingMore flag dedupes concurrent chain loads.
  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`${apiHref}&cursor=${encodeURIComponent(cursor)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = (await res.json()) as ExploreCategoryPageDTO;
      setExtra((prev) => [...prev, ...(page.videos ?? [])]);
      setCursor(page.nextCursor ?? null);
    } catch {
      // Keep the grid; the sentinel re-arms and retries on the next pass.
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

  const Icon = CATEGORY_ICONS[category] ?? Compass;
  const hasVideos = allVideos.length > 0;

  return (
    <div className="pb-10">
      <h1 className="flex items-center gap-2 px-4 py-4 text-xl font-bold sm:px-6 sm:text-2xl">
        <Icon className="size-7 text-yt-red" aria-hidden /> {category}
      </h1>

      {data?.publicMode && (
        <p data-testid="category-public-mode" className="px-4 pb-2 text-xs text-muted-foreground sm:px-6">
          Real {category.toLowerCase()} videos from YouTube search — YouTube&apos;s own category
          browse needs the YouTube session (public mode).
        </p>
      )}

      {/* the chip row — All + the 14 categories, URL-synced (Link navigation) */}
      <nav
        aria-label="Explore categories"
        className="flex gap-2 overflow-x-auto px-4 pb-4 sm:px-6 no-scrollbar"
      >
        {HOME_CHIPS.map((chip) => {
          const active = chip === category;
          return (
            <Link
              key={chip}
              href={chip === "All" ? "/explore" : categoryDestination(chip)}
              aria-current={active ? "page" : undefined}
              data-testid="category-chip"
              data-active={active}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-foreground text-background"
                  : "bg-secondary text-foreground hover:bg-accent"
              )}
            >
              {chip}
            </Link>
          );
        })}
      </nav>

      {loading && (
        <div
          className="grid grid-cols-1 gap-x-4 gap-y-9 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 2xl:grid-cols-4"
          aria-busy="true"
          aria-label={`Loading ${category}`}
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3">
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
      )}
      {error && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground" role="alert">
          {error}
        </p>
      )}
      {data && !hasVideos && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          Nothing in {category} right now — try another category.
        </p>
      )}

      {hasVideos && (
        <div
          className="grid grid-cols-1 gap-x-4 gap-y-9 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 2xl:grid-cols-4"
          data-testid="category-grid"
        >
          {allVideos.map((video) => (
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
      )}

      {data && hasVideos && cursor && (
        <div
          ref={sentinelRef}
          data-testid="category-scroll-sentinel"
          className="h-1"
          aria-hidden="true"
        />
      )}

      {/* the honest end — the cursor chain ran out after real pages */}
      {data && extra.length > 0 && !cursor && !loadingMore && (
        <p
          data-testid="category-end"
          className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-6"
        >
          No more videos — you&apos;ve reached the end
        </p>
      )}
    </div>
  );
}
