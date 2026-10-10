"use client";

import Link from "next/link";
import { SquarePlay } from "lucide-react";
import { displayViews } from "@/lib/format";
import { useHoverPreview } from "@/components/video/video-hover-preview";
import type { VideoDTO } from "@/lib/types";

/**
 * Shorts shelf — vertical cards in a horizontal rail (WebFlix pattern).
 *
 * P22-A sizing: youtube.com's shorts tiles SCALE with the viewport — live
 * measured 2026-10-10 from youtube.com's own shorts lockups (search-page
 * grid-shelf, 1440×900 viewport: 232px tiles; 1536: 264px; 1366: 207px;
 * 1280: 234px; ~1024: 168px) with the packet's home-shelf reference card
 * at 160×284 (9:16). P12's flat 208px was smaller than youtube.com at every
 * desktop width — the operator's report. The ladder below follows the
 * measured curve (base 160 → sm 192 → lg 216 → xl 232 = youtube's exact
 * 1280-1440 tile → 2xl 256 = youtube's 1536), always 9:16 like the home
 * shelf, so the tiles stay proportional to the 16:9 grid cards beside them
 * the way youtube.com's are.
 *
 * P22-A hover: shorts tiles PREVIEW ON HOVER like youtube.com (it plays
 * shorts on hover now — muted autoplay; verified live 2026-10-10: hovering
 * a shorts tile spawns youtube.com's ytd-video-preview with a muted
 * <video>). The same useHoverPreview pipeline as the home grid rides every
 * tile: embed mini player → storyboard → ken-burns. The old [data-no-preview]
 * opt-out (written when youtube.com did not preview shorts) is gone.
 */
export function ShortsShelf({ shorts }: { shorts: VideoDTO[] }) {
  if (shorts.length === 0) return null;
  return (
    <section aria-label="Shorts shelf" className="mt-8">
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
      aria-label={`Open Shorts: ${short.title}`}
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
      className="group flex w-[160px] shrink-0 flex-col gap-2 sm:w-[192px] lg:w-[216px] xl:w-[232px] 2xl:w-[256px]"
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
      </div>
      <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
        {short.title}
      </p>
      <p className="-mt-1 text-[13px] text-muted-foreground">{displayViews(short)}</p>
    </Link>
  );
}
