"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Info, Play } from "lucide-react";
import { MyListButton } from "./my-list-button";
import { PlayHandoffDialog } from "./play-handoff";
import { cn } from "@/lib/utils";
import type { NetflixTitleDTO } from "@/lib/netflix/types";

/**
 * P45 — the Netflix billboard. Netflix's own landing shape: a full-bleed
 * backdrop that fades into the hub, the "N FILM/N SERIES" kicker, logo art or
 * title treatment, the Top-10 badge line, synopsis, and the white Play +
 * translucent More Info buttons. Rotates through the day's top titles every
 * 9s with crossfades (paused on hover / reduced-motion), with the vertical
 * progress dots Netflix uses. The Play button enters the in-app watch lane
 * (/netflix/watch/<id> — the streamed Netflix player); More Info goes to the
 * WebFlix title page.
 */
const ROTATE_MS = 9_000;

export function NetflixBillboard({ titles }: { titles: NetflixTitleDTO[] }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const reducedMotion = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const list = titles.slice(0, 5);
  const count = list.length;

  useEffect(() => {
    reducedMotion.current =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (count < 2 || paused || reducedMotion.current) return;
    timerRef.current = setInterval(() => setIdx((i) => (i + 1) % count), ROTATE_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [count, paused]);

  if (count === 0) return null;
  const title = list[Math.min(idx, count - 1)];

  return (
    <section
      aria-label="Featured on Netflix"
      className="relative"
      data-testid="netflix-hero"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="relative h-[62vw] max-h-[560px] min-h-[380px] w-full overflow-hidden bg-[#101014] sm:h-[56vw]">
        {list.map((t, i) => (
          // P52 — the optimizer lane (report §4 rung 8): the billboard's
          // full-bleed art rides sized variants (100vw) instead of raw CDN
          // bytes; the first slide is priority (the LCP image), the rest lazy.
          <Image
            key={t.netflixId}
            src={t.backdropUrl ?? t.posterUrl ?? ""}
            alt=""
            aria-hidden={i !== idx}
            fill
            priority={i === 0}
            sizes="100vw"
            className={cn(
              "object-cover transition-opacity duration-1000",
              i === idx ? "opacity-100" : "opacity-0"
            )}
          />
        ))}
        {/* Netflix's billboard fades: bottom into the hub, left for the copy */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0c] via-[#0a0a0c]/25 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0c] via-[#0a0a0c]/55 to-transparent" />

        <div className="relative flex h-full flex-col justify-end gap-3 px-4 pb-10 pt-24 sm:px-[4vw] sm:pb-[7vw] md:pb-16">
          <p className="flex items-center gap-2 text-sm font-bold tracking-wide text-white/90">
            <span
              aria-hidden="true"
              className="text-2xl font-black leading-none text-[#e50914]"
            >
              N
            </span>
            {title.kind === "series" ? "SERIES" : "FILM"}
          </p>
          {title.logoUrl ? (
            <img
              key={title.netflixId}
              src={title.logoUrl}
              alt={title.title}
              className="max-h-16 w-auto max-w-[80%] object-contain drop-shadow-2xl sm:max-h-20 sm:max-w-[55%]"
            />
          ) : (
            <h1 className="max-w-3xl text-3xl font-black leading-tight text-white drop-shadow-lg sm:text-5xl">
              {title.title}
            </h1>
          )}
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-white/85">
            <span className="flex items-center gap-1.5 font-bold text-white">
              <span
                aria-hidden="true"
                className="flex h-5 items-center rounded-sm bg-[#e50914] px-1 text-[11px] font-black leading-none"
              >
                TOP
              </span>
              #{title.weeklyRank ?? title.allTimeRank ?? 1} in{" "}
              {title.kind === "series" ? "TV Shows" : "Movies"} Today
            </span>
            {title.releaseYear ? <span>{title.releaseYear}</span> : null}
            {title.maturityRating && (
              <span className="rounded border border-white/40 px-1.5 py-px text-xs font-semibold">
                {title.maturityRating}
              </span>
            )}
            {title.weeksInTop10 && title.weeksInTop10 > 1 ? (
              <span className="text-white/70">
                {title.weeksInTop10} weeks in the Top 10
              </span>
            ) : null}
          </p>
          {title.synopsis && (
            <p className="line-clamp-3 max-w-xl text-sm leading-relaxed text-white/90 drop-shadow sm:text-base">
              {title.synopsis}
            </p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <Link
              href={`/netflix/watch/${title.netflixId}`}
              data-testid="netflix-hero-play"
              className="flex h-11 items-center gap-2 rounded bg-white px-6 text-base font-bold text-black transition-colors hover:bg-white/80"
            >
              <Play className="size-5 fill-current" aria-hidden="true" />
              Play
            </Link>
            <Link
              href={`/netflix/t/${title.netflixId}`}
              data-testid="netflix-hero-info"
              className="flex h-11 items-center gap-2 rounded bg-white/25 px-5 text-base font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/35"
            >
              <Info className="size-5" aria-hidden="true" />
              More Info
            </Link>
            <div className="ml-auto hidden items-center gap-2 sm:flex">
              <MyListButton
                netflixId={title.netflixId}
                titleName={title.title}
                initial={false}
                variant="hero"
              />
              <button
                type="button"
                onClick={() => setHandoffOpen(true)}
                aria-label={`Open ${title.title} on netflix.com instead`}
                data-testid="netflix-hero-handoff"
                className="flex size-11 items-center justify-center rounded-full border border-white/40 bg-black/40 text-white transition-colors hover:bg-black/60"
              >
                <span aria-hidden="true" className="text-xs font-bold">
                  N
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* the vertical progress dots */}
        {count > 1 && (
          <div
            role="tablist"
            aria-label="Featured titles"
            className="absolute right-4 top-1/2 hidden -translate-y-1/2 flex-col items-center gap-2 sm:flex"
          >
            {list.map((t, i) => (
              <button
                key={t.netflixId}
                type="button"
                role="tab"
                aria-selected={i === idx}
                aria-label={`Show ${t.title}`}
                onClick={() => setIdx(i)}
                className={cn(
                  "h-1 rounded-full border-0 transition-all",
                  i === idx ? "h-6 w-1 bg-[#e50914]" : "h-1 w-1 bg-white/50 hover:bg-white/80"
                )}
              />
            ))}
          </div>
        )}
      </div>
      <PlayHandoffDialog title={title} open={handoffOpen} onOpenChange={setHandoffOpen} />
    </section>
  );
}

/** Back-compat alias — the hub and tests know the old name. */
export function NetflixHero({ titles }: { titles: NetflixTitleDTO[] }) {
  return <NetflixBillboard titles={titles} />;
}
