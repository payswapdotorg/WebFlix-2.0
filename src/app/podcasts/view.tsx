"use client";

import Link from "next/link";
import { Headphones, Mic } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { VerifiedBadge } from "@/components/app/verified-badge";
import type { PodcastCreatorDTO, PodcastShelfDTO, PodcastShowDTO, PodcastsPageDTO } from "@/lib/types";

/**
 * P25 G13 — youtube.com's podcasts destination page (/podcasts), the house
 * browse family (the explore-category/live surface's sibling).
 *
 * The MEASURED surface (2026-10-19, the packet's evidence pack — the
 * binding baseline): one page — a header ("Podcasts", the response's own
 * pageHeaderViewModel title) + the shelf family in document order
 * ("Popular episodes" video cards · "Popular podcasts" show lockups ·
 * "Live now" · the topic shelves · "Popular podcast creators" channel
 * cards). The served payload carries ZERO continuation tokens — the
 * surface is one page, so this view ships NO sentinel and NO chips (both
 * would be fabricated affordances; the honest form ends after the last
 * shelf). Every card target is the response's own: episodes → /watch/<id>,
 * shows → the measured Play-all watchEndpoint in the APP's own form
 * /watch/<videoId>?list=<playlistId> (the house Play-all idiom — the
 * playlist page's own link, the ?list= queue seam) with the publisher row →
 * /channel/<handle>, creators → /channel/<handle>.
 */

/** The podcast SHOW card (the measured lockupViewModel form): the square
 *  studio thumbnail + the episodes badge, the title, the publisher row
 *  (linked when the response carries the handle), the "Updated …" row.
 *  The house VideoCard link law: NO nested anchors — the card wrapper is a
 *  plain <article>; the thumbnail + title link the card's own Play-all
 *  target, the publisher row links the channel as a SIBLING. */
function PodcastShowCard({ show }: { show: PodcastShowDTO }) {
  // the card's own target is the measured Play-all watchEndpoint, in the
  // app's own form (the house Play-all idiom — /watch/<videoId>?list=<PL>,
  // the playlist page's own link; the watch route is /watch/[id], so the
  // youtube.com query form /watch?v=… has no route here) — no
  // playAllVideoId → no link (honest absence, never a dead href)
  const playAllHref = show.playAllVideoId
    ? `/watch/${show.playAllVideoId}?list=${encodeURIComponent(show.playlistId)}`
    : null;

  const thumb = (
    <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-secondary">
      {show.thumbnailUrl ? (
        <img
          src={show.thumbnailUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Headphones className="size-10 text-muted-foreground" aria-hidden="true" />
        </div>
      )}
      {show.episodeCountText && (
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-medium text-white">
          {show.episodeCountText}
        </span>
      )}
    </div>
  );

  return (
    <article className="w-[168px] shrink-0 sm:w-[188px]">
      {playAllHref ? (
        <Link
          href={playAllHref}
          aria-label={`Play all — ${show.title}`}
          data-testid="podcast-show-card"
          className="block"
        >
          {thumb}
        </Link>
      ) : (
        thumb
      )}

      {playAllHref ? (
        <Link href={playAllHref} className="mt-2 block">
          <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
            {show.title}
          </p>
        </Link>
      ) : (
        <p className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-foreground">
          {show.title}
        </p>
      )}

      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        {show.publisherHandle ? (
          <Link
            href={`/channel/${show.publisherHandle}`}
            className="flex w-fit items-center gap-1 hover:text-foreground"
          >
            <span className="truncate">{show.publisherName ?? show.publisherHandle}</span>
            {show.publisherVerified && <VerifiedBadge className="shrink-0" />}
          </Link>
        ) : (
          <>
            {show.publisherName}
            {show.publisherVerified && <VerifiedBadge className="shrink-0" />}
          </>
        )}
      </p>
      {show.updatedText && (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{show.updatedText}</p>
      )}
    </article>
  );
}

/** The podcast CREATOR card (the measured gridChannelRenderer form). */
function PodcastCreatorCard({ creator }: { creator: PodcastCreatorDTO }) {
  return (
    <Link
      href={`/channel/${creator.handle}`}
      data-testid="podcast-creator-card"
      className="flex w-[152px] shrink-0 flex-col items-center text-center sm:w-[176px]"
    >
      <Avatar className="size-24 sm:size-28">
        {creator.avatarUrl && <AvatarImage src={creator.avatarUrl} referrerPolicy="no-referrer" />}
        <AvatarFallback>{creator.name.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <p className="mt-2 line-clamp-2 text-sm font-medium text-foreground">{creator.name}</p>
      {creator.subscriberCountText && (
        <p className="mt-0.5 text-xs text-muted-foreground">{creator.subscriberCountText}</p>
      )}
      {creator.videoCountText && (
        <p className="mt-0.5 text-xs text-muted-foreground">{creator.videoCountText}</p>
      )}
    </Link>
  );
}

/** One measured shelf: the title + the horizontal rail of its own cards. */
function PodcastShelf({ shelf, index }: { shelf: PodcastShelfDTO; index: number }) {
  const hasCards =
    shelf.episodes.length > 0 || shelf.shows.length > 0 || shelf.creators.length > 0;
  if (!hasCards) return null;
  return (
    <section aria-label={shelf.title} data-testid="podcast-shelf" data-shelf-index={index}>
      <h2 className="px-4 py-3 text-lg font-semibold text-foreground sm:px-6 sm:text-xl">
        {shelf.title}
      </h2>
      <div className="no-scrollbar flex gap-4 overflow-x-auto px-4 pb-3 sm:px-6">
        {shelf.episodes.map((video) => (
          <VideoCard key={`${shelf.title}-${video.id}`} video={video} variant="rail" />
        ))}
        {shelf.shows.map((show) => (
          <PodcastShowCard key={`${shelf.title}-${show.playlistId}`} show={show} />
        ))}
        {shelf.creators.map((creator) => (
          <PodcastCreatorCard key={`${shelf.title}-${creator.id}`} creator={creator} />
        ))}
      </div>
    </section>
  );
}

export default function PodcastsView() {
  const { data, loading, error } = useApi<PodcastsPageDTO>("/api/podcasts");

  return (
    <div className="pb-10">
      <h1 className="flex items-center gap-2 px-4 py-4 text-xl font-bold sm:px-6 sm:text-2xl">
        <Mic className="size-7 text-yt-red" aria-hidden="true" />
        {data?.title ?? "Podcasts"}
      </h1>

      {data?.publicMode && (
        <p data-testid="podcasts-public-mode" className="px-4 pb-2 text-xs text-muted-foreground sm:px-6">
          Read live from youtube.com&apos;s public Podcasts page — YouTube&apos;s signed-in
          surfaces are session-walled (public mode).
        </p>
      )}

      {loading && (
        <div aria-busy="true" aria-label="Loading podcasts" className="px-4 sm:px-6">
          {Array.from({ length: 2 }).map((_, s) => (
            <div key={s} className="pb-6">
              <Skeleton className="mb-3 h-7 w-48" />
              <div className="flex gap-4 overflow-hidden">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex w-[320px] shrink-0 flex-col gap-3">
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
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground" role="alert">
          {error}
        </p>
      )}

      {data && data.shelves.length === 0 && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          Nothing on the podcasts page right now — try again shortly.
        </p>
      )}

      {data?.shelves.map((shelf, index) => (
        <PodcastShelf key={`${shelf.title}-${index}`} shelf={shelf} index={index} />
      ))}
    </div>
  );
}
