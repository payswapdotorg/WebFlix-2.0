"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { NetflixCard } from "./netflix-card";
import { cn } from "@/lib/utils";
import type { NetflixRailDTO } from "@/lib/netflix/types";

/**
 * P45 — one hub rail, Netflix's row shape: the header with a "Top 10" red
 * tag on ranked rows, and the hover-revealed chevron paging (scrolls a full
 * viewport step, keyboard reachable, always visible on touch). Weekly rows
 * render the ranked portrait cards with the giant numerals; the Most
 * Popular rows stay 16:9. Renders nothing when the pool dropped out (the
 * honest absence).
 */
export function NetflixRail({ rail }: { rail: NetflixRailDTO }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(true);

  if (rail.titles.length === 0) return null;

  const ranked = rail.ranking === "weekly";

  const page = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  const updateArrows = () => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 8);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  };

  return (
    <section aria-label={rail.label} className="group/rail relative mt-7 sm:mt-9" data-testid={`netflix-rail-${rail.key}`}>
      <div className="flex items-baseline justify-between gap-3 px-4 sm:px-[4vw]">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold text-white sm:text-xl">
          {ranked && (
            <span
              aria-hidden="true"
              className="flex h-5 items-center rounded-sm bg-[#e50914] px-1 text-[11px] font-black leading-none"
            >
              TOP 10
            </span>
          )}
          {rail.label}
          <span className="text-sm font-normal text-white/50">· {rail.country}</span>
        </h2>
        {rail.weekEndDate && (
          <span className="shrink-0 text-xs text-white/40">week of {rail.weekEndDate}</span>
        )}
      </div>

      <div className="relative mt-3">
        {/* chevron paging — hover-revealed on pointers, always there on touch */}
        <button
          type="button"
          onClick={() => page(-1)}
          disabled={!canPrev}
          aria-label={`Scroll ${rail.label} back`}
          className={cn(
            "absolute left-0 top-1/2 z-20 hidden h-[70%] w-9 -translate-y-1/2 items-center justify-center rounded-r-md bg-black/60 text-white transition-opacity disabled:opacity-0 group-hover/rail:opacity-100 sm:flex",
            canPrev ? "opacity-0 group-hover/rail:opacity-100" : "opacity-0"
          )}
        >
          <ChevronLeft className="size-7" />
        </button>
        <button
          type="button"
          onClick={() => page(1)}
          disabled={!canNext}
          aria-label={`Scroll ${rail.label} forward`}
          className={cn(
            "absolute right-0 top-1/2 z-20 hidden h-[70%] w-9 -translate-y-1/2 items-center justify-center rounded-l-md bg-black/60 text-white transition-opacity sm:flex",
            canNext ? "opacity-0 group-hover/rail:opacity-100" : "opacity-0"
          )}
        >
          <ChevronRight className="size-7" />
        </button>

        <div
          ref={scrollerRef}
          onScroll={updateArrows}
          className="no-scrollbar flex gap-3 overflow-x-auto scroll-smooth px-4 py-4 sm:gap-3.5 sm:px-[4vw]"
          data-testid={`netflix-rail-scroll-${rail.key}`}
        >
          {rail.titles.map((title, i) => (
            <NetflixCard
              key={`${rail.key}-${title.netflixId}`}
              title={title}
              rank={ranked ? i + 1 : null}
              variant={ranked ? "ranked" : "default"}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
