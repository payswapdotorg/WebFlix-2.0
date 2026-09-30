"use client";

import { useState } from "react";
import Link from "next/link";
import { Layers, Loader2 } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { VerifiedBadge } from "@/components/app/verified-badge";
import { formatSubscribers } from "@/lib/format";
import type { ChannelLite, SubscriptionsPageDTO, VideoDTO } from "@/lib/types";

type SubscriptionsPayload = {
  channels: ChannelLite[];
  videos: VideoDTO[];
  nextCursor: string | null;
  loginRequired: boolean;
  session: boolean;
};

/** Subscriptions — the operator's REAL subscriptions feed (SSR /feed/subscriptions). */
export default function SubscriptionsPage() {
  const { data, loading, error } = useApi<SubscriptionsPayload>("/api/subscriptions");
  const [extraVideos, setExtraVideos] = useState<VideoDTO[]>([]);
  const [paging, setPaging] = useState<{ cursor: string | null; loading: boolean }>({
    cursor: null,
    loading: false,
  });

  const channels = data?.channels ?? [];
  const videos = [...(data?.videos ?? []), ...extraVideos];
  const hasMore = Boolean(paging.cursor ?? data?.nextCursor);

  async function loadMore() {
    const cursor = paging.cursor ?? data?.nextCursor ?? null;
    if (!cursor) return;
    setPaging({ cursor, loading: true });
    try {
      const res = await fetch(`/api/subscriptions?cursor=${encodeURIComponent(cursor)}`);
      const body = (await res.json()) as SubscriptionsPayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setExtraVideos((prev) => [...prev, ...body.videos]);
      setPaging({ cursor: body.nextCursor, loading: false });
    } catch {
      setPaging({ cursor, loading: false });
    }
  }

  return (
    <div className="pb-6">
      <h1 className="flex items-center gap-2 px-4 py-4 text-xl font-bold sm:px-6 sm:text-2xl">
        <Layers className="size-7 text-yt-red" /> Subscriptions
      </h1>

      {/* channel avatar rail */}
      <div className="no-scrollbar flex gap-5 overflow-x-auto px-4 pb-2 sm:px-6">
        {channels.map((ch) => (
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
      {data && data.loginRequired && (
        <div className="px-4 py-16 text-center sm:px-6">
          <p className="text-lg font-medium">Sign in to see your subscriptions feed</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The subscriptions feed is personal — it reads from the YouTube account this WebFlix
            session rides (single-tenant live mode). No session is configured right now.
          </p>
        </div>
      )}
      {data && !data.loginRequired && channels.length === 0 && videos.length === 0 && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          No subscriptions surfaced — subscribe from any channel page.
        </p>
      )}

      {videos.length > 0 && (
        <section aria-label="Latest from your subscriptions" className="mt-4">
          <h2 className="px-4 pb-3 text-lg font-semibold sm:px-6">Latest</h2>
          <div className="grid grid-cols-1 gap-x-4 gap-y-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 2xl:grid-cols-4">
            {videos.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center px-4 py-6 sm:px-6">
              <Button
                variant="secondary"
                className="rounded-full"
                onClick={loadMore}
                disabled={paging.loading}
              >
                {paging.loading ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" /> Loading…
                  </>
                ) : (
                  "Load more"
                )}
              </Button>
            </div>
          )}
        </section>
      )}

      {channels.length > 0 && (
        <section aria-label="Your channels" className="mt-8 px-4 sm:px-6">
          <h2 className="pb-3 text-lg font-semibold">Manage</h2>
          <div className="divide-y divide-border/40 rounded-xl border border-border/60">
            {channels.map((ch) => (
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
                  <p className="text-xs text-muted-foreground">
                    {ch.subscriberCount > 0 ? formatSubscribers(ch.subscriberCount) : "Subscribed"}
                  </p>
                </div>
              </Link>
            ))}
          </div>
          <p className="px-1 pt-2 text-xs text-muted-foreground">
            Subscribe/unsubscribe from any channel page — it acts on the real YouTube account.
          </p>
        </section>
      )}
    </div>
  );
}
