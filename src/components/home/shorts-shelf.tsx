"use client";

import Link from "next/link";
import { SquarePlay } from "lucide-react";
import { displayViews } from "@/lib/format";
import type { VideoDTO } from "@/lib/types";

/** Shorts shelf — vertical cards in a horizontal rail (WebFlix pattern). */
export function ShortsShelf({ shorts }: { shorts: VideoDTO[] }) {
  if (shorts.length === 0) return null;
  return (
    <section aria-label="Shorts shelf" className="mt-8">
      <h2 className="flex items-center gap-2 px-4 text-lg font-semibold text-foreground sm:px-6 sm:text-xl">
        <SquarePlay className="size-6 text-yt-red" strokeWidth={2.2} /> Shorts
      </h2>
      <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto px-4 pb-2 sm:px-6">
        {shorts.map((short) => (
          <Link
            key={short.id}
            href="/shorts"
            aria-label={`Open Shorts: ${short.title}`}
            className="group flex w-[157px] shrink-0 flex-col gap-2"
          >
            <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-secondary">
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
            <p className="-mt-1 text-[13px] text-muted-foreground">
              {displayViews(short)}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
