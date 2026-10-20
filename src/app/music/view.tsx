"use client";

import Link from "next/link";
import { Disc3 } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { useHoverPreview } from "@/components/video/video-hover-preview";
import { VerifiedBadge } from "@/components/app/verified-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, displayViews, displayPublished } from "@/lib/format";
import type { MusicDestinationDTO, VideoDTO } from "@/lib/types";

/**
 * P30 — youtube.com's music destination page (/music), the house browse
 * family (the podcasts destination's sibling).
 *
 * THE MEASURED REFERENCE (2026-10-20, live from this egress — youtube.com/
 * music resolves to the Music channel surface): a channel-style header
 * (the banner art strip, the overlapping circular avatar, the name, the
 * tab row) + THE SHELF FAMILY of SQUARE lockups (~249px covers, 1:1,
 * rounded, title + meta beneath — never the regular 16:9 home grid). This
 * view mirrors that shape with real data: one shelf per Music seed query
 * (the shelf titles are the queries themselves, sentence-cased), square
 * music lockups in horizontal rails, hover previews riding the same
 * useHoverPreview ladder as every other card.
 *
 * The surface is one page — NO sentinel and NO chips (the honest
 * no-affordance law the podcasts destination set: zero continuation
 * exists, so neither is fabricated).
 */

/**
 * One square music lockup — the reference's shelf card shape: a 1:1 cover
 * (16:9 thumbnails center-cropped like album art), the duration/LIVE/
 * members badges, title + channel + views·age beneath. Its own hover
 * preview instance (hooks never ride a loop), the handlers on the article
 * exactly like VideoCard — the preview anchors to [data-thumb-anchor].
 */
function MusicLockup({ video }: { video: VideoDTO }) {
  const hover = useHoverPreview(video);
  return (
    <article
      className="group w-[200px] shrink-0 sm:w-[224px] lg:w-[248px] xl:w-[264px]"
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
    >
      <Link
        href={`/watch/${video.id}`}
        aria-label={`Watch ${video.title}`}
        className="block"
      >
        <div
          data-thumb-anchor=""
          className="relative aspect-square w-full overflow-hidden rounded-xl bg-secondary"
        >
          <img
            src={video.thumbnailUrl}
            alt={video.title}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
          />
          {video.isLive ? (
            <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-sm bg-yt-red px-1.5 py-0.5 text-[11px] font-bold uppercase text-white">
              <span className="size-1.5 rounded-full bg-white" aria-hidden="true" /> Live
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
        <h3
          title={video.title}
          className="mt-2.5 line-clamp-2 text-sm font-medium leading-snug text-foreground"
        >
          {video.title}
        </h3>
      </Link>
      <Link
        href={`/channel/${video.channel.handle}`}
        className="mt-1 flex w-fit items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="truncate">{video.channel.name}</span>
        {video.channel.verified && <VerifiedBadge />}
      </Link>
      <p className="text-[13px] text-muted-foreground">
        {displayViews(video)}
        {displayPublished(video) ? ` · ${displayPublished(video)}` : ""}
      </p>
    </article>
  );
}

/** One shelf: the seed query's own title + the horizontal rail of square
 *  lockups (hidden honestly when the query returned nothing). */
function MusicShelf({ shelf, index }: { shelf: MusicDestinationDTO["shelves"][number]; index: number }) {
  if (shelf.videos.length === 0) return null;
  return (
    <section aria-label={shelf.title} data-testid="music-shelf" data-shelf-index={index} className="mt-6 first:mt-4">
      <h2 className="px-4 py-2 text-lg font-semibold text-foreground sm:px-6 sm:text-xl">
        {shelf.title}
      </h2>
      <div className="no-scrollbar flex gap-4 overflow-x-auto px-4 pb-2 sm:px-6">
        {shelf.videos.map((video) => (
          <MusicLockup key={`${shelf.title}-${video.id}`} video={video} />
        ))}
      </div>
    </section>
  );
}

/** The channel-style header: banner art strip + overlapping circular
 *  avatar + the name + the tab row (the measured Music-channel shape). */
function MusicHeader({ title }: { title: string }) {
  return (
    <header>
      {/* the banner — warm house family (the Music channel's art strip) */}
      <div className="relative h-28 w-full overflow-hidden sm:h-36" aria-hidden="true">
        <div className="absolute inset-0 bg-gradient-to-r from-yt-red/90 via-rose-500/70 to-amber-400/50" />
        <div className="absolute -right-16 -top-28 size-72 rounded-full bg-white/10" />
        <div className="absolute right-28 top-6 size-16 rounded-full bg-white/10" />
        <div className="absolute -bottom-10 left-1/3 size-24 rounded-full bg-black/10" />
      </div>
      <div className="flex flex-wrap items-end gap-4 px-4 pb-2 sm:gap-6 sm:px-6">
        <div className="-mt-10 flex size-20 shrink-0 items-center justify-center rounded-full bg-background shadow-lg ring-1 ring-border sm:-mt-14 sm:size-28">
          <Disc3 className="size-10 text-yt-red sm:size-14" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-foreground sm:text-4xl">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Music videos, new releases &amp; live performances
          </p>
        </div>
      </div>
      {/* the tab row — the channel-page look; Home is the only honest
          surface on this destination (never a fabricated tab) */}
      <nav aria-label="Music sections" className="mt-2 flex gap-8 border-b border-border px-4 sm:px-6">
        <span
          aria-current="page"
          className="border-b-2 border-foreground pb-3 pt-2 text-sm font-medium text-foreground"
        >
          Home
        </span>
      </nav>
    </header>
  );
}

export default function MusicView() {
  const { data, loading, error } = useApi<MusicDestinationDTO>("/api/music");

  return (
    <div className="pb-10">
      <MusicHeader title={data?.title ?? "Music"} />

      {data?.publicMode && (
        <p data-testid="music-public-mode" className="px-4 pb-2 pt-4 text-xs text-muted-foreground sm:px-6">
          Real music shelves from YouTube search — YouTube&apos;s signed-in music destination is
          session-walled (public mode).
        </p>
      )}

      {loading && (
        <div aria-busy="true" aria-label="Loading music" className="px-4 pt-6 sm:px-6">
          {Array.from({ length: 2 }).map((_, s) => (
            <div key={s} className="pb-6">
              <Skeleton className="mb-3 h-7 w-44" />
              <div className="flex gap-4 overflow-hidden">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex w-[248px] shrink-0 flex-col gap-2.5">
                    <Skeleton className="aspect-square w-full rounded-xl" />
                    <Skeleton className="h-4 w-11/12" />
                    <Skeleton className="h-3 w-2/3" />
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
          Nothing on the music page right now — try again shortly.
        </p>
      )}

      {data?.shelves.map((shelf, index) => (
        <MusicShelf key={`${shelf.title}-${index}`} shelf={shelf} index={index} />
      ))}
    </div>
  );
}
