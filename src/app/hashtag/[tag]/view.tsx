"use client";

import { useEffect, useRef, useState } from "react";
import { Hash } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { HashtagPageDTO, VideoDTO } from "@/lib/types";

/**
 * REA-1 G17 — the hashtag browse view (youtube.com's /hashtag/<tag>
 * surface, measured live 2026-10-17): the "#tag" header + the meta line
 * ("7M videos • 1.4M channels" — the response's own numbers), the video
 * grid, and the sentinel infinite scroll over the continuation chain (the
 * search/explore-category family). Honest states only: an upstream failure
 * renders the honest status note — never a fabricated grid.
 */
export default function HashtagView({ tag }: { tag: string }) {
  const apiHref = `/api/hashtag/${encodeURIComponent(tag)}`;
  const { data, loading, error } = useApi<HashtagPageDTO>(apiHref);

  // --- infinite scroll state (mirrors the explore-category view) ----------
  const [extra, setExtra] = useState<VideoDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset pagination when the tag changes (the same view serves every tag).
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

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`${apiHref}?cursor=${encodeURIComponent(cursor)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = (await res.json()) as HashtagPageDTO;
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

  // First page + every appended page, deduped by id (the client owns the
  // dedupe — continuation pages can repeat a card).
  const seenIds = new Set<string>();
  const allVideos = [...(data?.videos ?? []), ...extra].filter((v) => {
    if (seenIds.has(v.id)) return false;
    seenIds.add(v.id);
    return true;
  });

  const hasVideos = allVideos.length > 0;

  return (
    <div className="pb-10">
      {/* the measured header: the #tag + the response's own meta line */}
      <h1
        className="flex items-center gap-2 px-4 py-4 text-xl font-bold sm:px-6 sm:text-2xl"
        data-testid="hashtag-title"
      >
        <Hash className="size-6 text-yt-red" aria-hidden />#{tag}
      </h1>
      {data?.metaText && (
        <p className="px-4 pb-4 text-sm text-muted-foreground sm:px-6" data-testid="hashtag-meta">
          {data.metaText}
        </p>
      )}

      {loading && (
        <div
          className="grid grid-cols-1 gap-x-4 gap-y-9 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 2xl:grid-cols-4"
          aria-busy="true"
          aria-label={`Loading #${tag}`}
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

      {/* the honest status-note family (P22-B wording patterns) — an upstream
          failure NEVER renders a fabricated grid */}
      {error && (
        <div className="px-4 py-10 text-center sm:px-6" role="alert" data-testid="hashtag-error">
          <p className="text-lg font-medium">#{tag} is unavailable right now</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            The YouTube read behind this hashtag didn&apos;t come back — it may be temporary, or
            YouTube didn&apos;t serve it to WebFlix. Try again in a moment.
          </p>
        </div>
      )}

      {data && !hasVideos && !error && (
        <p
          className="px-4 py-10 text-center text-sm text-muted-foreground sm:px-6"
          data-testid="hashtag-empty"
        >
          No videos under #{tag} right now — try another hashtag.
        </p>
      )}

      {hasVideos && (
        <div
          className="grid grid-cols-1 gap-x-4 gap-y-9 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 2xl:grid-cols-4"
          data-testid="hashtag-grid"
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
          data-testid="hashtag-scroll-sentinel"
          className="h-1"
          aria-hidden="true"
        />
      )}

      {/* the honest end — the cursor chain ran out after real pages */}
      {data && extra.length > 0 && !cursor && !loadingMore && (
        <p
          className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-6"
          data-testid="hashtag-end"
        >
          No more videos — you&apos;ve reached the end
        </p>
      )}
    </div>
  );
}
