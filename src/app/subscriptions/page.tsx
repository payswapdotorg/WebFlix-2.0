"use client";

import Link from "next/link";
import { Layers } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import { VerifiedBadge } from "@/components/app/verified-badge";
import { formatSubscribers } from "@/lib/format";
import type { SubscriptionsPageDTO } from "@/lib/types";

/** Subscriptions — your channels + their latest videos (real Subscribe rows). */
export default function SubscriptionsPage() {
  const { data, loading, error } = useApi<SubscriptionsPageDTO>("/api/subscriptions");

  return (
    <div className="pb-6">
      <h1 className="flex items-center gap-2 px-4 py-4 text-xl font-bold sm:px-6 sm:text-2xl">
        <Layers className="size-7 text-yt-red" /> Subscriptions
      </h1>

      {/* channel avatar rail */}
      <div className="no-scrollbar flex gap-5 overflow-x-auto px-4 pb-2 sm:px-6">
        {(data?.channels ?? []).map((ch) => (
          <Link
            key={ch.id}
            href={`/channel/${ch.handle}`}
            className="flex w-20 shrink-0 flex-col items-center gap-1.5 text-center"
          >
            <img
              src={ch.avatarUrl}
              alt={ch.name}
              className="size-14 rounded-full object-cover ring-2 ring-transparent transition-shadow hover:ring-primary/60"
            />
            <span className="flex items-center gap-1 text-xs text-foreground/90">
              <span className="truncate">{ch.name}</span>
              {ch.verified && <VerifiedBadge />}
            </span>
          </Link>
        ))}
        {loading &&
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex w-20 shrink-0 flex-col items-center gap-1.5" aria-hidden="true">
              <Skeleton className="size-14 rounded-full" />
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
      </div>

      {loading && (
        <div className="grid grid-cols-1 gap-x-4 gap-y-8 px-4 py-6 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3">
              <Skeleton className="aspect-video w-full rounded-xl" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      )}
      {error && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground" role="alert">
          {error}
        </p>
      )}
      {data && data.channels.length === 0 && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          You haven't subscribed to any channels yet — find one through search or the home feed.
        </p>
      )}
      {data && data.channels.length > 0 && data.videos.length === 0 && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          Your channels haven't published any public videos yet.
        </p>
      )}

      {data && data.videos.length > 0 && (
        <section aria-label="Latest from your subscriptions" className="mt-4">
          <h2 className="px-4 pb-3 text-lg font-semibold sm:px-6">Latest</h2>
          <div className="grid grid-cols-1 gap-x-4 gap-y-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 2xl:grid-cols-4">
            {data.videos.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
        </section>
      )}

      {data && data.channels.length > 0 && (
        <section aria-label="Your channels" className="mt-8 px-4 sm:px-6">
          <h2 className="pb-3 text-lg font-semibold">Manage</h2>
          <div className="divide-y divide-border/40 rounded-xl border border-border/60">
            {data.channels.map((ch) => (
              <Link
                key={ch.id}
                href={`/channel/${ch.handle}`}
                className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-accent/40"
              >
                <img src={ch.avatarUrl} alt="" className="size-10 rounded-full object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 text-sm font-medium">
                    <span className="truncate">{ch.name}</span>
                    {ch.verified && <VerifiedBadge />}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatSubscribers(ch.subscriberCount)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
