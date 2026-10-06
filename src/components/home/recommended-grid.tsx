"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { VideoDTO, VideoPageDTO } from "@/lib/types";

/**
 * P12-UX — the recommended grid, split into the infinite-scroll hook + the
 * presentational grid.
 *
 * The hook keeps the keyset-pagination contract exactly (fetch
 * /api/videos?cursor=… when the sentinel scrolls into view) — but the
 * SENTINEL itself now renders at the very END of the home feed (below the
 * rails/shorts shelf), so the grid-first youtube.com layout never starves
 * the rails: appended pages can no longer push them away mid-scroll.
 *
 * Card sizing = youtube.com measured 2026-10-06 (live DOM vars + skeleton
 * CSS): item min-width ~327-332px, item margin 16px (gap-x-4), row margin
 * 36px (gap-y-9), responsive 1/2/3/4-up (4-up at ≳1300px content, exactly
 * youtube.com's adaptive rich-grid behavior).
 */
export function useRecommendedInfiniteScroll(
  initialVideos: VideoDTO[] | undefined,
  initialCursor: string | null,
  category: string
) {
  const [videos, setVideos] = useState<VideoDTO[]>(initialVideos ?? []);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset the grid when a fresh page arrives (guarded render-phase reset).
  const [prevInitial, setPrevInitial] = useState(initialVideos);
  if (prevInitial !== initialVideos) {
    setPrevInitial(initialVideos);
    setVideos(initialVideos ?? []);
    setCursor(initialCursor);
  }

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ cursor, category, limit: "12" });
      const res = await fetch(`/api/videos?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = (await res.json()) as VideoPageDTO;
      setVideos((prev) => {
        const seen = new Set(prev.map((v) => v.id));
        const fresh = page.videos.filter((v) => !seen.has(v.id));
        return [...prev, ...fresh];
      });
      setCursor(page.nextCursor);
    } catch {
      // Keep the grid; the user can scroll again to retry.
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, category]);

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

  return { videos, cursor, loading, sentinelRef };
}

/**
 * The grid itself — regular full-size youtube.com-parity thumbnails from
 * the first row (P12-UX Task 1/2: no giant hero above it, no heading —
 * exactly youtube.com's home).
 */
export function RecommendedGrid({
  videos,
  loading,
}: {
  videos: VideoDTO[];
  loading: boolean;
}) {
  return (
    <section aria-label="Recommended videos" className="px-4 pb-4 pt-2 sm:px-6">
      <div className="grid grid-cols-1 gap-x-4 gap-y-9 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {videos.map((video) => (
          <VideoCard key={video.id} video={video} />
        ))}
        {loading &&
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
    </section>
  );
}
