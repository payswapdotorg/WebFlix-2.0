"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * P90 — the home shelf scroller: the horizontal rail row WITH its scroll
 * affordance (the operator's report: "the horizontal list of shorts/tiktok
 * videos is not scrollable on the home page"). The rows were always
 * CSS-scrollable (`overflow-x-auto`), but `no-scrollbar` hides the only
 * affordance and a desktop mouse wheel does not translate to horizontal
 * scroll — so the shelves read as stuck.
 *
 * The fix is the repo's own Netflix rail law (P45 netflix-rail.tsx),
 * generalized: hover-revealed chevron paging (a full-viewport step,
 * smooth-scrolled), disabled at the edges, keyboard reachable, invisible on
 * coarse-pointer/`<sm` viewports where the native swipe stays the gesture.
 * The scroller keeps `no-scrollbar overflow-x-auto` — the mobile contract
 * and the no-page-overflow law are untouched.
 */
export function ShelfScroller({
  label,
  testId,
  className,
  children,
}: {
  /** The aria-label fragment for the paging buttons ("Shorts", "TikTok"). */
  label: string;
  /** The scroller row's own data-testid (the lane hooks). */
  testId: string;
  /** Extra row classes when a shelf needs them (defaults keep the ladder). */
  className?: string;
  children?: ReactNode;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(true);

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

  // The edge states re-measure on mount-layout, viewport resizes and
  // content changes (async data landing) — not only on scroll, so a shelf
  // that already fits its viewport never shows a dead forward chevron.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => updateArrows());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="group/shelf relative" data-testid={`${testId}-scroller`}>
      {/* chevron paging — hover-revealed on pointers, native swipe below sm */}
      <button
        type="button"
        onClick={() => page(-1)}
        disabled={!canPrev}
        aria-label={`Scroll ${label} back`}
        data-testid={`${testId}-page-left`}
        className={cn(
          "absolute left-0 top-1/2 z-20 hidden h-[70%] w-9 -translate-y-1/2 items-center justify-center rounded-r-md bg-black/60 text-white transition-opacity disabled:opacity-0 group-hover/shelf:opacity-100 sm:flex",
          canPrev ? "opacity-0 group-hover/shelf:opacity-100" : "opacity-0",
        )}
      >
        <ChevronLeft className="size-7" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => page(1)}
        disabled={!canNext}
        aria-label={`Scroll ${label} forward`}
        data-testid={`${testId}-page-right`}
        className={cn(
          "absolute right-0 top-1/2 z-20 hidden h-[70%] w-9 -translate-y-1/2 items-center justify-center rounded-l-md bg-black/60 text-white transition-opacity disabled:opacity-0 group-hover/shelf:opacity-100 sm:flex",
          canNext ? "opacity-0 group-hover/shelf:opacity-100" : "opacity-0",
        )}
      >
        <ChevronRight className="size-7" aria-hidden="true" />
      </button>

      <div
        ref={scrollerRef}
        onScroll={updateArrows}
        data-testid={testId}
        className={cn(
          "no-scrollbar mt-3 flex gap-4 overflow-x-auto scroll-smooth px-4 pb-2 sm:px-6",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
