"use client";

import { useState } from "react";
import Link from "next/link";
import { Layers, LayoutGrid, List, Loader2 } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { VerifiedBadge } from "@/components/app/verified-badge";
import { formatSubscribers, formatDuration, displayViews, displayPublished } from "@/lib/format";
import type { ChannelLite, VideoDTO } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PersonalSurfaceGate } from "@/components/auth/personal-surface-gate";
import { useSubsLayout, useSubsLayoutHydration } from "./layout-store";

type SubscriptionsPayload = {
  channels: ChannelLite[];
  videos: VideoDTO[];
  nextCursor: string | null;
  loginRequired: boolean;
  session: boolean;
};

/** Subscriptions — the operator's REAL subscriptions feed (SSR /feed/subscriptions).
 * WFX2-P2-AU: guests get the youtube.com signed-out screen (the gate).
 * P18-SUBS-NOTIFS: the feed header carries YouTube's grid/list layout
 * switcher; the choice persists in localStorage (wf-subs-layout — the
 * layout-store, the sidebar-store idiom) and only changes how the SAME real
 * rows render. */
export default function SubscriptionsPage() {
  return (
    <PersonalSurfaceGate surface="subscriptions">
      <SubscriptionsContent />
    </PersonalSurfaceGate>
  );
}

function SubscriptionsContent() {
  const { data, loading, error } = useApi<SubscriptionsPayload>("/api/subscriptions");
  const [extraVideos, setExtraVideos] = useState<VideoDTO[]>([]);
  const [paging, setPaging] = useState<{ cursor: string | null; loading: boolean }>({
    cursor: null,
    loading: false,
  });

  // P18: the persisted grid ⇄ list choice (skipHydration + mount rehydrate —
  // no SSR mismatch; rows paint after the fetch, after rehydration).
  const layout = useSubsLayout((s) => s.layout);
  const setLayout = useSubsLayout((s) => s.setLayout);
  useSubsLayoutHydration();

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
      <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
          <Layers className="size-7 text-yt-red" /> Subscriptions
        </h1>

        {/* P18 — the feed layout switcher (YouTube's grid/list toggle): the
            active icon gets the filled pill; the choice persists locally. */}
        <div
          role="group"
          aria-label="Feed layout"
          data-testid="subs-layout-toggle"
          className="flex shrink-0 items-center gap-1 rounded-full bg-secondary/60 p-1"
        >
          <button
            type="button"
            onClick={() => setLayout("grid")}
            aria-pressed={layout === "grid"}
            aria-label="Grid view"
            title="Grid view"
            data-testid="subs-layout-grid"
            data-active={layout === "grid" ? "true" : undefined}
            className={cn(
              "flex size-8 items-center justify-center rounded-full transition-colors",
              layout === "grid"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <LayoutGrid className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setLayout("list")}
            aria-pressed={layout === "list"}
            aria-label="List view"
            title="List view"
            data-testid="subs-layout-list"
            data-active={layout === "list" ? "true" : undefined}
            className={cn(
              "flex size-8 items-center justify-center rounded-full transition-colors",
              layout === "list"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <List className="size-4" />
          </button>
        </div>
      </div>

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

      {loading && layout === "list" && (
        <div
          className="flex flex-col gap-4 px-4 py-6 sm:px-6"
          aria-busy="true"
          aria-label="Loading subscriptions"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-4" aria-hidden="true">
              <Skeleton className="aspect-video w-[168px] shrink-0 rounded-xl" />
              <div className="flex-1 space-y-2 pt-1">
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}
      {loading && layout !== "list" && (
        <div
          className="grid grid-cols-1 gap-x-4 gap-y-8 px-4 py-6 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 2xl:grid-cols-4"
          aria-busy="true"
          aria-label="Loading subscriptions"
        >
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
          {layout === "list" ? (
            <div className="flex flex-col gap-4 px-4 sm:px-6" data-testid="subs-list">
              {videos.map((video) => (
                <SubsListRow key={video.id} video={video} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-x-4 gap-y-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 2xl:grid-cols-4">
              {videos.map((video) => (
                <VideoCard key={video.id} video={video} />
              ))}
            </div>
          )}
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

/**
 * P18-SUBS-NOTIFS — YouTube's subscription LIST row: the 16:9 thumbnail
 * (~168px) left; right block = the 2-line clamped title, the meta line
 * (views · age), the channel avatar + name row, and the description snippet
 * — ONLY when the feed's own payload carries one (the SSR /feed/subscriptions
 * lockups carry no description today; the row honestly omits the line rather
 * than fabricating a snippet). Same real VideoDTO rows as the grid — the
 * toggle only changes the rendering.
 */
function SubsListRow({ video }: { video: VideoDTO }) {
  const age = displayPublished(video);
  return (
    <article data-testid="subs-list-row" className="flex gap-4">
      <Link
        href={`/watch/${video.id}`}
        aria-label={`Watch ${video.title}`}
        className="relative block w-[168px] shrink-0 overflow-hidden rounded-xl bg-secondary"
      >
        <div className="relative aspect-video w-full">
          <img
            src={video.thumbnailUrl}
            alt={video.title}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {video.isLive ? (
            <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-sm bg-yt-red px-1.5 py-0.5 text-[11px] font-bold uppercase text-white">
              <span className="size-1.5 rounded-full bg-white" /> Live
            </span>
          ) : video.durationSec !== null ? (
            <span className="duration-badge absolute bottom-1.5 right-1.5 rounded-sm px-1.5 py-0.5 text-[11px] font-medium tabular-nums">
              {formatDuration(video.durationSec)}
            </span>
          ) : null}
          {video.isMembersOnly && (
            <span className="absolute left-1.5 top-1.5 rounded-sm bg-yt-red px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Members
            </span>
          )}
        </div>
      </Link>
      <div className="min-w-0 flex-1 py-0.5">
        <Link href={`/watch/${video.id}`} className="block">
          <h3
            title={video.title}
            className="line-clamp-2 text-sm font-medium leading-snug text-foreground"
          >
            {video.title}
          </h3>
        </Link>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {displayViews(video)}
          {age ? ` · ${age}` : ""}
        </p>
        <Link
          href={`/channel/${video.channel.handle}`}
          className="mt-1 flex w-fit items-center gap-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Avatar className="size-6">
            {video.channel.avatarUrl ? <AvatarImage src={video.channel.avatarUrl} alt="" /> : null}
            <AvatarFallback className="text-[10px]">
              {video.channel.name.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="truncate font-medium text-foreground/90">{video.channel.name}</span>
          {video.channel.verified && <VerifiedBadge />}
        </Link>
        {video.description && (
          <p className="mt-1 line-clamp-1 text-[13px] leading-snug text-muted-foreground">
            {video.description}
          </p>
        )}
      </div>
    </article>
  );
}
