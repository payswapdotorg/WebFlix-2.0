"use client";

import Link from "next/link";
import { Compass, Radio } from "lucide-react";
import { CATEGORIES, categoryDestination } from "@/lib/categories";
import { cn } from "@/lib/utils";

const CATEGORY_ICON_NAMES: Record<string, string> = {
  Music: "Music",
  Gaming: "Gamepad2",
  News: "Newspaper",
  Sports: "Trophy",
  Coding: "Code",
  Tech: "Cpu",
  Education: "GraduationCap",
  Travel: "Plane",
  Cooking: "ChefHat",
  Fitness: "Dumbbell",
  Comedy: "Clapperboard",
  Mixes: "Disc3",
  Podcasts: "Mic",
};

/**
 * The Explore hub (WFX2-B-W; WFX2-P19-EXPL) — youtube.com's explore pattern:
 * a category grid where every card lands on a real-data destination (the
 * category's own browse page, or the Live surface).
 */
export default function ExplorePage() {
  return (
    <div className="pb-10">
      <h1 className="flex items-center gap-2 px-4 py-4 text-xl font-bold sm:px-6 sm:text-2xl">
        <Compass className="size-7 text-yt-red" aria-hidden /> Explore
      </h1>
      <p className="px-4 pb-6 text-sm text-muted-foreground sm:px-6">
        Browse YouTube by category — every card opens a real category browse page with a
        ranked grid of real videos, plus the Live surface.
      </p>

      <div className="grid grid-cols-2 gap-4 px-4 sm:grid-cols-3 lg:grid-cols-4 sm:px-6">
        {/* Live — the headline card (the live filter search surface) */}
        <Link
          href="/explore/live"
          className="group relative flex aspect-[4/3] flex-col justify-end overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-yt-red/25 via-secondary to-secondary p-4 transition-colors hover:border-foreground/30"
        >
          <span className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-yt-red px-2.5 py-1 text-[11px] font-bold uppercase text-white">
            <span className="size-1.5 animate-pulse rounded-full bg-white" aria-hidden /> Live
          </span>
          <Radio className="mb-2 size-8 text-foreground/80" strokeWidth={1.6} aria-hidden />
          <p className="text-lg font-semibold">Live</p>
          <p className="text-xs text-muted-foreground">Streams happening right now</p>
        </Link>

        {CATEGORIES.filter((c) => c !== "Live").map((category) => {
          return (
            <Link
              key={category}
              href={categoryDestination(category)}
              className={cn(
                "group flex aspect-[4/3] flex-col justify-end rounded-2xl border border-border bg-secondary/60 p-4 transition-colors",
                "hover:border-foreground/30 hover:bg-secondary"
              )}
            >
              <p className="text-lg font-semibold">{category}</p>
              <p className="text-xs text-muted-foreground">
                Real {category.toLowerCase()} videos from YouTube search
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
