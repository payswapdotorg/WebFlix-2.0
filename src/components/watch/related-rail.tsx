"use client";

/**
 * WFX2-W related rail — compact video cards (thumbnail + duration + title +
 * channel + views/age), infinite "Show more" cursor; the autoplay-next video
 * is this rail's head (first item of the first page).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { api, post } from "@/lib/watch/client";
import { compactCount, formatDuration, relativeTime } from "@/lib/watch/format";
import type { PageDto, RelatedVideoDto } from "@/lib/watch/types";

export function RelatedRail({
  videoId,
  onFirstPage,
}: {
  videoId: string;
  onFirstPage?: (head: RelatedVideoDto | null) => void;
}) {
  const [items, setItems] = useState<RelatedVideoDto[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // WFX2-P7-AN — the viewer's watched map (one batch POST per page load;
  // lights the WATCHED strips on the rail cards, never a per-card fetch)
  const [watchedMap, setWatchedMap] = useState<Record<string, number>>({});

  // fetch the watched map for a freshly loaded page's ids (capped batch)
  const fetchWatchedMap = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      const r = await post<{ map: Record<string, number> }>("/api/watch/watched-map", {
        videoIds: ids.slice(0, 50),
      });
      setWatchedMap((prev) => ({ ...prev, ...r.map }));
    } catch {
      // the badge is an enrichment, never a load-blocker
    }
  }, []);

  // fresh mount per video (the parent keys the watch page) → single fetch
  useEffect(() => {
    let alive = true;
    api<PageDto<RelatedVideoDto>>(`/api/videos/${videoId}/related`)
      .then((page) => {
        if (!alive) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        onFirstPage?.(page.items[0] ?? null);
        void fetchWatchedMap(page.items.map((v) => v.id));
      })
      .catch((e) => {
        if (alive) toast.error(e instanceof Error ? e.message : "Failed to load related videos");
      });
    return () => {
      alive = false;
    };
  }, [videoId, onFirstPage, fetchWatchedMap]);

  const showMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api<PageDto<RelatedVideoDto>>(
        `/api/videos/${videoId}/related?cursor=${encodeURIComponent(cursor)}`
      );
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setCursor(page.nextCursor);
      void fetchWatchedMap(page.items.map((v) => v.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, videoId]);

  if (items === null) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading related videos">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex gap-2 p-1">
            <div className="aspect-video w-40 shrink-0 animate-pulse rounded-md bg-secondary" />
            <div className="flex-1 space-y-2 pt-0.5">
              <div className="h-3 w-full animate-pulse rounded bg-secondary" />
              <div className="h-3 w-3/4 animate-pulse rounded bg-secondary" />
              <div className="h-2.5 w-1/2 animate-pulse rounded bg-secondary" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
        No related videos yet.
      </p>
    );
  }

  return (
    <div>
      <h2 className="mb-3 text-base font-bold">Up next</h2>
      <div className="flex flex-col gap-2">
        {items.map((v) => (
          <RelatedCard key={v.id} video={v} watchedSec={watchedMap[v.id]} />
        ))}
      </div>
      {cursor && (
        <button
          type="button"
          onClick={showMore}
          disabled={loadingMore}
          className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-full border border-border text-sm font-medium transition hover:bg-accent disabled:opacity-50"
        >
          {loadingMore ? (
            <>
              <span className="size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
              Loading…
            </>
          ) : (
            "Show more"
          )}
        </button>
      )}
    </div>
  );
}

function RelatedCard({ video, watchedSec }: { video: RelatedVideoDto; watchedSec?: number }) {
  return (
    <Link
      href={`/watch/${video.id}`}
      className="group flex gap-2 rounded-lg p-1 transition hover:bg-secondary/40 focus-visible:bg-secondary/40 focus-visible:outline-none"
      aria-label={`${video.title} by ${video.channel.name}, ${video.viewsText ?? `${compactCount(video.views)} views`}, ${video.publishedText ?? relativeTime(video.createdAt)}`}
    >
      <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-md bg-secondary">
        <img
          src={video.thumbnailUrl}
          alt=""
          loading="lazy"
          className="size-full object-cover transition-transform duration-200 group-hover:scale-105"
        />
        <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[10px] font-medium tabular-nums text-white">
          {formatDuration(video.durationSec)}
        </span>
        {watchedSec !== undefined && (
          <span
            data-testid="related-card-watched"
            className="absolute bottom-0 left-0 right-0 bg-neutral-900/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
          >
            Watched
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <h3 className="line-clamp-2 text-sm font-medium leading-tight">{video.title}</h3>
        <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
          {video.channel.name}
          {video.channel.verified && <BadgeCheck className="size-3.5 shrink-0" aria-label="Verified channel" />}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {video.viewsText ?? `${compactCount(video.views)} views`}{video.publishedText ?? relativeTime(video.createdAt) ? ` · ${video.publishedText ?? relativeTime(video.createdAt)}` : ""}
        </p>
      </div>
    </Link>
  );
}
