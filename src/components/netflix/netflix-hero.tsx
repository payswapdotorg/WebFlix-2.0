"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Play } from "lucide-react";
import { MyListButton } from "./my-list-button";
import { PlayHandoffDialog } from "./play-handoff";
import type { NetflixTitleDTO } from "@/lib/netflix/types";

/**
 * P42 — the hub hero: the top weekly global title, Netflix-style (backdrop,
 * logo art, synopsis, Play → the hand-off, My List). Renders only with a real
 * title — the honest absence again.
 */
export function NetflixHero({ title, myListInitial }: { title: NetflixTitleDTO; myListInitial: boolean }) {
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [artBroken, setArtBroken] = useState(false);
  const isSeries = title.kind === "series";
  const metaBits = [
    title.releaseYear ? String(title.releaseYear) : null,
    isSeries ? "Series" : "Film",
    title.maturityRating,
    title.weeksInTop10 ? `${title.weeksInTop10} ${title.weeksInTop10 === 1 ? "week" : "weeks"} in Top 10` : null,
  ].filter(Boolean) as string[];

  return (
    <section aria-label="Featured on Netflix" className="relative mx-4 mt-4 overflow-hidden rounded-2xl sm:mx-6" data-testid="netflix-hero">
      <div className="relative min-h-[280px] bg-gradient-to-br from-[#1b1b22] to-[#101014] sm:min-h-[380px]">
        {title.backdropUrl && !artBroken && (
          <img
            src={title.backdropUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setArtBroken(true)}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0c] via-[#0a0a0c]/55 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0c]/80 via-transparent to-transparent" />

        <div className="relative flex h-full max-w-2xl flex-col justify-end gap-3 p-5 sm:p-8">
          {title.logoUrl && !artBroken ? (
            <img src={title.logoUrl} alt={title.title} className="max-h-14 w-auto max-w-[70%] object-contain drop-shadow-lg" />
          ) : (
            <h1 className="text-2xl font-black text-white drop-shadow sm:text-4xl">{title.title}</h1>
          )}
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/70">
            <span className="rounded bg-[#e50914] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
              Top {title.weeklyRank ?? 1}
            </span>
            {metaBits.map((bit) => (
              <span key={bit}>{bit}</span>
            ))}
          </p>
          {title.synopsis && (
            <p className="line-clamp-3 max-w-xl text-sm leading-relaxed text-white/85 sm:text-base">
              {title.synopsis}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href={`/netflix/watch/${title.netflixId}`}
              data-testid="netflix-hero-play"
              className="flex h-11 items-center gap-2 rounded-md bg-[#e50914] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#c4080f]"
            >
              <Play className="size-4 fill-current" aria-hidden="true" />
              Play
            </Link>
            <button
              type="button"
              onClick={() => setHandoffOpen(true)}
              data-testid="netflix-hero-handoff"
              className="flex h-11 items-center gap-2 rounded-md border border-white/25 px-5 text-sm font-medium text-white/90 transition-colors hover:bg-white/10"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              Open on Netflix
            </button>
            <MyListButton
              netflixId={title.netflixId}
              titleName={title.title}
              initial={myListInitial}
              variant="hero"
            />
          </div>
        </div>
      </div>
      <PlayHandoffDialog title={title} open={handoffOpen} onOpenChange={setHandoffOpen} />
    </section>
  );
}
