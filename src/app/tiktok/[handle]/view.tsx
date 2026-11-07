"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink, Music2, PlugZap } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount } from "@/lib/format";
import { TikTokCard } from "@/components/tiktok/tiktok-card";
import { TikTokThumbnailImage } from "@/components/tiktok/tiktok-thumbnail-image";
import { shortsTikTokHref } from "@/lib/shorts/feed-contracts";
import type { TikTokChannelPageDTO } from "@/lib/tiktok/types";

/**
 * P94-a — the TikTok channel view: the YouTube channel page's grammar
 * (banner → avatar/name/stats header → tab strip → tile grid) over the
 * DERIVED TikTok channel DTO. Honesty laws it renders by:
 *  - no follower/like totals (oEmbed carries none) — the real post count
 *    names itself ("N posts on WebFlix");
 *  - the avatar is an aggregator candidate with an initials fallback; the
 *    banner is the latest verified post thumbnail with a music-glyph
 *    gradient fallback;
 *  - "Follow on TikTok" rides the OUTBOUND profile link (the capability
 *    map's canFollow=false law — WebFlix never claims a TikTok write);
 *  - an empty shelf still renders the header + the import CTA (never a
 *    fake row).
 */

type ChannelTab = "videos" | "about";

const tabStorageKey = (handle: string) => `wfx2:tiktok-channel:tab:${handle}`;

function readStoredTab(handle: string): ChannelTab {
  try {
    const stored = localStorage.getItem(tabStorageKey(handle));
    if (stored === "videos" || stored === "about") return stored;
  } catch {
    /* private mode */
  }
  return "videos";
}

function ChannelAvatar({ dto }: {
  dto: TikTokChannelPageDTO["channel"];
}) {
  const initials = dto.nickname
    ? dto.nickname.slice(0, 2).toUpperCase()
    : dto.handle.slice(0, 2).toUpperCase();
  return (
    <TikTokThumbnailImage
      src={dto.avatarUrl}
      alt={dto.nickname ? `${dto.nickname} on TikTok` : `@${dto.handle} on TikTok`}
      testId="tiktok-channel-avatar"
      className="size-20 rounded-full object-cover sm:size-24"
      fallback={
        <span
          className="flex size-20 items-center justify-center rounded-full bg-secondary text-xl font-bold text-secondary-foreground sm:size-24"
          aria-hidden="true"
        >
          {initials}
        </span>
      }
    />
  );
}

function ChannelBanner({ dto }: { dto: TikTokChannelPageDTO["channel"] }) {
  return (
    <div className="h-28 w-full overflow-hidden bg-secondary sm:h-44" data-testid="tiktok-channel-banner">
      <TikTokThumbnailImage
        src={dto.bannerUrl}
        alt=""
        className="size-full object-cover"
        fallback={
          <div className="flex size-full items-center justify-center bg-gradient-to-r from-secondary via-accent to-secondary">
            <Music2 className="size-8 text-muted-foreground/60" aria-hidden="true" />
          </div>
        }
      />
    </div>
  );
}

export function TikTokChannelView({ handle }: { handle: string }) {
  const { data, loading, error, reload } = useApi<TikTokChannelPageDTO>(
    `/api/tiktok/channel/${encodeURIComponent(handle)}`,
  );
  const [tab, setTab] = useState<ChannelTab>("videos");
  // The last-open tab, remembered per channel (the YouTube page's idiom).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration of the stored tab (SSR renders videos) — the channel-page idiom
    setTab(readStoredTab(handle));
  }, [handle]);

  function selectTab(next: ChannelTab) {
    setTab(next);
    try {
      localStorage.setItem(tabStorageKey(handle), next);
    } catch {
      /* private mode */
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-[1284px] px-4 py-6 sm:px-6">
        <Skeleton className="h-28 w-full rounded-none sm:h-44" />
        <div className="mt-4 flex items-center gap-4 px-1">
          <Skeleton className="size-20 rounded-full sm:size-24" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <div className="mt-8 flex gap-2">
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-20 rounded-full" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <h1 className="text-lg font-semibold">This TikTok channel could not load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error ?? "The channel lane answered nothing."} The embed players keep working in the
          Shorts feed either way.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button variant="outline" onClick={reload}>Try again</Button>
          <Button asChild variant="secondary">
            <Link href="/shorts?source=tiktok">Open TikTok in Shorts</Link>
          </Button>
        </div>
      </div>
    );
  }

  const { channel, videos, universeSize, note } = data;
  const displayName = channel.nickname ?? `@${channel.handle}`;

  return (
    <div className="mx-auto max-w-[1284px] pb-16">
      <ChannelBanner dto={channel} />

      {/* header — the YouTube channel header's grammar (avatar → name →
          handle/stats line → actions), honest TikTok data */}
      <div className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
        <ChannelAvatar dto={channel} />
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-bold sm:text-3xl" data-testid="tiktok-channel-name">
            <span className="truncate">{displayName}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground" data-testid="tiktok-channel-stats">
            @{channel.handle}
            {" · "}
            <span className="font-medium text-foreground">
              {formatCount(channel.postCount)} {channel.postCount === 1 ? "post" : "posts"}
            </span>{" "}
            on WebFlix
          </p>
          {channel.nickname && channel.nickname !== channel.handle ? (
            <p className="mt-0.5 text-xs text-muted-foreground">TikTok · @{channel.handle}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* canFollow=false (no TikTok write API) — the honest follow is the
              outbound profile link, where the real Follow button lives */}
          <a
            href={channel.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="tiktok-channel-outbound"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-foreground px-4 text-sm font-medium text-background transition hover:bg-foreground/90 active:scale-[0.97]"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            Follow on TikTok
          </a>
          <Button asChild variant="secondary" className="rounded-full">
            {/* P96-a (G17): the scoped feed — TikTok profile parity: the
                profile CTA plays THAT creator's sequence, not the shared
                firehose. */}
            <Link
              href={shortsTikTokHref({ creator: channel.handle })}
              data-testid="tiktok-channel-watch-scoped"
            >
              Watch in Shorts
            </Link>
          </Button>
        </div>
      </div>

      {/* tab strip — the YouTube page's tab grammar, TikTok's honest tabs */}
      <div
        role="tablist"
        aria-label={`${displayName}'s TikTok channel sections`}
        className="flex justify-center gap-2 border-b px-4 sm:px-6"
      >
        {(
          [
            { id: "videos", label: "Videos" },
            { id: "about", label: "About" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            data-testid={`tiktok-channel-tab-${t.id}`}
            onClick={() => selectTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "videos" ? (
        <section aria-label="Videos" className="px-4 pt-6 sm:px-6">
          {note ? (
            <div className="rounded-xl border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground" data-testid="tiktok-channel-note">
              {note}
            </div>
          ) : null}
          {videos.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Music2 className="size-8 text-muted-foreground/60" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                Nothing here yet — add one of @{channel.handle}&apos;s posts and it lands on this
                channel.
              </p>
              <Button asChild variant="secondary" className="rounded-full">
                <Link href="/shorts?source=tiktok">Add a TikTok post</Link>
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-6" data-testid="tiktok-channel-grid">
              {videos.map((video) => (
                // P96-a (G17): the scoped deep link — a profile tap plays
                // within this creator's sequence (TikTok's own profile
                // behavior); hub/search/home keep the shared canonical law.
                <TikTokCard key={video.postId} video={video} scopedCreator={channel.handle} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <section aria-label="About" className="px-4 py-6 sm:px-6" data-testid="tiktok-channel-about">
          <div className="max-w-2xl space-y-4 text-sm text-muted-foreground">
            <h2 className="text-base font-semibold text-foreground">
              About this channel
            </h2>
            <p>
              WebFlix&apos;s TikTok channel pages are derived from the posts already riding
              WebFlix&apos;s shelf — the curated citations plus community imports. WebFlix claims no
              profile data it cannot verify: no follower totals, no bio, no verified badge — those
              live on TikTok.
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="font-medium text-foreground">Handle</dt>
              <dd>@{channel.handle}</dd>
              <dt className="font-medium text-foreground">Posts on WebFlix</dt>
              <dd>
                {formatCount(channel.postCount)} of {formatCount(universeSize)} shelf posts
              </dd>
              <dt className="font-medium text-foreground">Profile</dt>
              <dd className="break-all">
                <a
                  href={channel.profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground underline underline-offset-2"
                >
                  {channel.profileUrl}
                </a>
              </dd>
            </dl>
            <p className="flex items-start gap-2 rounded-xl border bg-secondary/40 px-4 py-3">
              <PlugZap className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {data.viewerLinked ? (
                <span data-testid="tiktok-about-linked">
                  This is you — linked as @{channel.handle} in{" "}
                  <Link
                    href="/settings#tiktok-connection"
                    className="font-medium text-foreground underline underline-offset-2"
                  >
                    Settings
                  </Link>
                  . The link names your creator identity locally; it is not a
                  TikTok authorization, and no TikTok write is claimed or
                  performed.
                </span>
              ) : (
                <span>
                  Is this you? Connect your TikTok account in{" "}
                  <Link
                    href="/settings#tiktok-connection"
                    className="font-medium text-foreground underline underline-offset-2"
                  >
                    Settings
                  </Link>{" "}
                  to manage your posts from here.
                </span>
              )}
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
