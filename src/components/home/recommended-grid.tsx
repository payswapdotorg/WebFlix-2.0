"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { VideoDTO, VideoPageDTO } from "@/lib/types";

/**
 * Recommended grid with infinite scroll — fetches /api/videos?cursor=…
 * (keyset pagination) when the sentinel scrolls into view.
 */
export function RecommendedGrid({
  initialVideos,
  initialCursor,
  category,
}: {
  initialVideos: VideoDTO[];
  initialCursor: string | null;
  category: string;
}) {
  const [videos, setVideos] = useState<VideoDTO[]>(initialVideos);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset the grid when a fresh page arrives (guarded render-phase reset).
  const [prevInitial, setPrevInitial] = useState(initialVideos);
  if (prevInitial !== initialVideos) {
    setPrevInitial(initialVideos);
    setVideos(initialVideos);
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

  return (
    <section aria-label="Recommended videos" className="mt-8 px-4 pb-8 sm:px-6">
      <h2 className="text-lg font-semibold text-foreground sm:text-xl">Recommended</h2>
      <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
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
      {cursor && (
        <div ref={sentinelRef} data-testid="infinite-scroll-sentinel" className="h-1" aria-hidden="true" />
      )}
    </section>
  );
}
