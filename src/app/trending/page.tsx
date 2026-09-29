"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Flame } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { formatViews, formatRelativeDate, formatDuration } from "@/lib/format";
import { CategoryChips } from "@/components/home/category-chips";
import { Skeleton } from "@/components/ui/skeleton";
import { VerifiedBadge } from "@/components/app/verified-badge";
import { HOME_CHIPS, normalizeCategory } from "@/lib/categories";
import type { TrendingPageDTO } from "@/lib/types";

/**
 * Trending — the ranked list (views desc) with category chips (WebFlix tabs).
 * Full tabs + windows arrive with WFX2-D (Wave 3).
 */
export default function TrendingPage() {
  return (
    <Suspense fallback={<TrendingSkeleton />}>
      <TrendingContent />
    </Suspense>
  );
}

function TrendingContent() {
  const params = useSearchParams();
  const category = normalizeCategory(params.get("category"));
  const { data, loading, error } = useApi<TrendingPageDTO>(
    `/api/trending?category=${encodeURIComponent(category)}`
  );

  return (
    <div>
      <h1 className="flex items-center gap-2 px-4 py-4 text-xl font-bold sm:px-6 sm:text-2xl">
        <Flame className="size-7 text-yt-red" /> Trending
      </h1>
      <CategoryChips chips={HOME_CHIPS} active={category} />
      {loading && <TrendingSkeleton />}
      {error && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground" role="alert">
          {error}
        </p>
      )}
      {data && data.videos.length === 0 && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          Nothing trending in {category} yet.
        </p>
      )}
      <ol className="px-4 sm:px-6">
        {(data?.videos ?? []).map((video, i) => (
          <li key={video.id} className="border-b border-border/40 last:border-b-0">
            <Link
              href={`/watch/${video.id}`}
              className="group flex gap-4 py-4 transition-colors sm:gap-6"
            >
              <span className="hidden w-8 shrink-0 pt-8 text-center text-xl font-semibold text-muted-foreground tabular-nums sm:block">
                {i + 1}
              </span>
              <div className="relative aspect-video w-[140px] shrink-0 overflow-hidden rounded-xl bg-secondary sm:w-[240px]">
                <img
                  src={video.thumbnailUrl}
                  alt={video.title}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover"
                />
                {video.isLive ? (
                  <span className="absolute bottom-1.5 right-1.5 rounded-sm bg-yt-red px-1.5 py-0.5 text-[11px] font-bold uppercase text-white">
                    Live
                  </span>
                ) : (
                  <span className="duration-badge absolute bottom-1.5 right-1.5 rounded-sm px-1.5 py-0.5 text-[11px] font-medium tabular-nums">
                    {formatDuration(video.durationSec)}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="line-clamp-2 text-base font-medium text-foreground sm:text-lg">
                  {video.title}
                </h2>
                <p className="mt-1 flex items-center gap-1 text-[13px] text-muted-foreground">
                  <span className="truncate">{video.channel.name}</span>
                  {video.channel.verified && <VerifiedBadge />}
                </p>
                <p className="text-[13px] text-muted-foreground">
                  {formatViews(video.views)} · {formatRelativeDate(video.createdAt)}
                  {video.category !== "All" && ` · ${video.category}`}
                </p>
                {video.isMembersOnly && (
                  <span className="mt-1 inline-block rounded-sm bg-yt-red/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                    Members only
                  </span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TrendingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading trending">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-4 sm:gap-6 sm:px-6">
          <Skeleton className="aspect-video w-[140px] shrink-0 rounded-xl sm:w-[240px]" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3.5 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
