"use client";

import Link from "next/link";
import { Flame, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { displayViews, displayPublished } from "@/lib/format";
import type { VideoDTO } from "@/lib/types";

/** Trending #1 hero — big card with gradient scrim + red pill (WebFlix pattern). */
export function HeroCard({ video }: { video: VideoDTO }) {
  return (
    <section aria-label="Trending #1" className="px-4 pt-1 sm:px-6">
      <Link
        href={`/watch/${video.id}`}
        className="group relative block overflow-hidden rounded-2xl"
        aria-label={`Watch trending #1: ${video.title}`}
      >
        <div className="relative aspect-video w-full bg-secondary">
          <img
            src={video.thumbnailUrl}
            alt={video.title}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="hero-scrim absolute inset-0" />
          <span className="absolute left-4 top-4 flex items-center gap-1.5 rounded-md bg-yt-red px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
            <Flame className="size-3.5" /> Trending #1
          </span>
          <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6">
            <h2 className="line-clamp-2 max-w-[85%] text-xl font-bold leading-tight text-[#ff4488] drop-shadow-sm sm:text-3xl">
              {video.title}
            </h2>
            <p className="mt-2 text-sm text-white/90 drop-shadow-sm">
              {video.channel.name} · {displayViews(video)}
              {displayPublished(video) ? ` · ${displayPublished(video)}` : ""}
            </p>
            <span className="mt-3 inline-flex">
              <Button
                asChild
                size="sm"
                className="rounded-full bg-white/95 text-black hover:bg-white"
                tabIndex={-1}
              >
                <span className="pointer-events-none">
                  <Play className="mr-1 size-4 fill-black" /> Watch now
                </span>
              </Button>
            </span>
          </div>
        </div>
      </Link>
    </section>
  );
}
