"use client";

import Link from "next/link";
import { Radio } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { displayViews } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { VerifiedBadge } from "@/components/app/verified-badge";
import type { LivePageDTO } from "@/lib/types";

/**
 * The Live surface (WFX2-B-W) — real currently-live videos (the Features→
 * Live search filter over a live-scoped query set, merged). Every card
 * carries the real LIVE badge + watching count; clicking → the watch page
 * (the embed plays the live stream + the live-chat panel — already built).
 */
export default function LivePage() {
  const { data, loading, error } = useApi<LivePageDTO>("/api/live?limit=24");

  return (
    <div className="pb-10">
      <h1 className="flex items-center gap-2 px-4 py-4 text-xl font-bold sm:px-6 sm:text-2xl">
        <span className="flex size-7 items-center justify-center rounded-full bg-yt-red text-white" aria-hidden>
          <Radio className="size-4" />
        </span>
        Live
        <span className="ml-1 flex items-center gap-1.5 rounded-full bg-yt-red/10 px-2.5 py-0.5 text-xs font-bold uppercase text-yt-red">
          <span className="size-1.5 animate-pulse rounded-full bg-yt-red" aria-hidden /> Now
        </span>
      </h1>
      <p className="px-4 pb-6 text-sm text-muted-foreground sm:px-6">
        Live streams happening right now — from YouTube search’s live filter.
      </p>

      {loading && (
        <div
          className="grid grid-cols-1 gap-x-4 gap-y-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 2xl:grid-cols-4"
          aria-busy="true"
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-video w-full rounded-xl" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      )}
      {error && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground" role="alert">
          {error}
        </p>
      )}
      {data && data.videos.length === 0 && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          No live streams matching right now — try again in a moment.
        </p>
      )}
      {data && data.videos.length > 0 && (
        <div className="grid grid-cols-1 gap-x-4 gap-y-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 2xl:grid-cols-4">
          {data.videos.map((video) => (
            <article key={video.id} className="group flex flex-col">
              <Link
                href={`/watch/${video.id}`}
                aria-label={`Watch ${video.title} (live)`}
                className="relative block overflow-hidden rounded-xl bg-secondary"
              >
                <div className="relative aspect-video w-full">
                  <img
                    src={video.thumbnailUrl}
                    alt={video.title}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-sm bg-yt-red px-1.5 py-0.5 text-[11px] font-bold uppercase text-white">
                    <span className="size-1.5 rounded-full bg-white" aria-hidden /> Live
                  </span>
                </div>
              </Link>
              <div className="mt-3 flex min-w-0 flex-1 gap-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/watch/${video.id}`} className="block">
                    <h2 className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                      {video.title}
                    </h2>
                  </Link>
                  <Link
                    href={`/channel/${video.channel.handle}`}
                    className="mt-1 flex w-fit items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span className="truncate">{video.channel.name}</span>
                    {video.channel.verified && <VerifiedBadge />}
                  </Link>
                  <p className="text-[13px] font-medium text-muted-foreground">
                    {video.viewsText ?? displayViews(video)}
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
