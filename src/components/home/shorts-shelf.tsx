"use client";

import Link from "next/link";
import { SquarePlay } from "lucide-react";
import { displayViews } from "@/lib/format";
import { useHoverPreview } from "@/components/video/video-hover-preview";
import type { VideoDTO } from "@/lib/types";

/**
 * Shorts shelf — vertical cards in a horizontal rail (WebFlix pattern).
 *
 * 2026-10-16 operator pass — SIZE + PLACEMENT + LIVE:
 *
 * SIZE: the operator reported the shorts boxes smaller than youtube.com's.
 * The P22-A ladder matched youtube.com's SEARCH-page grid-shelf tiles
 * (232px @1440), but youtube.com's HOME shelf tiles run one step larger at
 * every width (the home shelf is the bigger lockup the operator compares
 * against). The ladder below is the home-shelf scale: base 168 → sm 192 →
 * lg 234 → xl 264 → 2xl 296, always 9:16 — proportional to the 16:9 grid
 * cards beside them exactly the way youtube.com's home shelf is.
 *
 * PLACEMENT: the shelf is interleaved within the recommended grid by
 * home-feed.tsx (first rows → shelf → rest) — youtube.com's own home
 * composition, not a bottom-of-page section.
 *
 * LIVE: youtube.com's shorts surfaces carry live shorts (the mobile app's
 * shorts feed mixes LIVE vertical streams in); a live short renders the red
 * LIVE badge over the tile and the viewer count instead of view count.
 */
export function ShortsShelf({ shorts }: { shorts: VideoDTO[] }) {
  if (shorts.length === 0) return null;
  return (
    <section aria-label="Shorts shelf" className="mt-2">
      <h2 className="flex items-center gap-2 px-4 text-lg font-semibold text-foreground sm:px-6 sm:text-xl">
        <SquarePlay className="size-6 text-yt-red" strokeWidth={2.2} /> Shorts
      </h2>
      <div className="no-scrollbar mt-3 flex gap-4 overflow-x-auto px-4 pb-2 sm:px-6">
        {shorts.map((short) => (
          <ShortsTile key={short.id} short={short} />
        ))}
      </div>
    </section>
  );
}

/**
 * One shorts tile — a component of its own because every tile needs its own
 * useHoverPreview instance (hooks never ride a loop).
 */
function ShortsTile({ short }: { short: VideoDTO }) {
  const hover = useHoverPreview(short);
  return (
    <Link
      href="/shorts"
      aria-label={`Open Shorts: ${short.title}${short.isLive ? " (live)" : ""}`}
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
      className="group flex w-[168px] shrink-0 flex-col gap-2 sm:w-[192px] lg:w-[234px] xl:w-[264px] 2xl:w-[296px]"
    >
      <div
        data-thumb-anchor=""
        className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-secondary"
      >
        <img
          src={short.thumbnailUrl}
          alt={short.title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
        />
        {short.isLive ? (
          <span className="absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded bg-yt-red px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            <span className="size-1.5 rounded-full bg-white" aria-hidden="true" />
            Live
          </span>
        ) : null}
        {short.durationSec && !short.isLive ? (
          <span className="absolute bottom-2 right-2 z-10 rounded bg-black/80 px-1 py-0.5 text-[10px] font-medium text-white">
            {short.durationSec < 60
              ? `0:${String(short.durationSec).padStart(2, "0")}`
              : `${Math.floor(short.durationSec / 60)}:${String(short.durationSec % 60).padStart(2, "0")}`}
          </span>
        ) : null}
      </div>
      <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
        {short.title}
      </p>
      <p className="-mt-1 text-[13px] text-muted-foreground">
        {short.isLive
          ? short.viewsText && /watch/i.test(short.viewsText)
            ? short.viewsText
            : "Watching now"
          : displayViews(short)}
      </p>
    </Link>
  );
}
