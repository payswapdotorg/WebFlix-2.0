"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * ADR 0013 — the shared Shorts feed shell (WFX2-TIKTOK-SHORTS-EXPERIENCE-1
 * M0 contract freeze). ONE presentation experience, many providers.
 *
 * The shell owns the presentation mechanics ONLY — the same laws the YouTube
 * feed proved since WFX2-A-S, extracted verbatim and generalized over the
 * slide item type:
 *  - HEIGHT CONTRACT: the AppShell wraps page children in a plain
 *    `div.flex-1` whose used height comes from flexing — percentage heights
 *    (h-full) do NOT resolve against it (classic flex-item gotcha, verified
 *    in-browser). The shell MEASURES that slot (the page renders
 *    div.h-full > <adapter>, so the slot is the shell root's grandparent)
 *    with a ResizeObserver and applies it as an explicit height. The footer
 *    stays visible at the bottom and main never scrolls — the shell is the
 *    scroller.
 *  - ACTIVE SLIDE: IntersectionObserver threshold 0.6 drives
 *    `onActiveIndexChange` (adapters own what "active" means for their
 *    player/meta) and fires `onEnterLastTwo` when the active slide enters
 *    the last two slides (the cursor-pagination trigger).
 *  - NAVIGATION: keyboard ArrowUp/ArrowDown (yielding to inputs, open
 *    sheets/dialogs and defaultPrevented events), smooth snap scrolling.
 *    Desktop chevrons are rendered BY each slide through the slide control
 *    (the geometry wrapper is provider-specific).
 *
 * The shell knows NOTHING about YouTube or TikTok: no DTO, no player, no
 * action route crosses this boundary (ADR 0013 §1/§3). Loading, error and
 * empty chrome are rendered from the shell's state union so every source
 * keeps the exact same states the YouTube feed shipped.
 */

export interface ShortsSlideControl {
  index: number;
  active: boolean;
  goNext: () => void;
  goPrev: () => void;
  scrollToIndex: (index: number) => void;
}

export type ShortsShellState =
  | { kind: "loading"; label: string; spinnerClassName?: string }
  | { kind: "error"; message: string; onRetry: () => void }
  | { kind: "empty"; message: string }
  | { kind: "ready" };

export function ShortsFeedShell<T>({
  state,
  chrome,
  items,
  getItemKey,
  slideAriaLabel,
  renderSlide,
  onActiveIndexChange,
  onEnterLastTwo,
  keyboardLocked,
  loadingMore = false,
  loadingMoreLabel = "Loading more",
  ariaLabel,
  footer,
}: {
  state: ShortsShellState;
  /** The chips row above the feed (source selector + provider filters). */
  chrome: React.ReactNode;
  /** Ready-state items; ignored unless `state.kind === "ready"`. */
  items: readonly T[];
  getItemKey: (item: T, index: number) => string;
  slideAriaLabel: (item: T, index: number) => string;
  renderSlide: (item: T, control: ShortsSlideControl) => React.ReactNode;
  /** Fires whenever the active slide changes (adapters mirror it for meta). */
  onActiveIndexChange?: (index: number) => void;
  /** Fires when the active slide enters the last two slides (paging). */
  onEnterLastTwo?: () => void;
  /** True while a sheet/dialog owns the keyboard (the feed yields). */
  keyboardLocked?: () => boolean;
  loadingMore?: boolean;
  loadingMoreLabel?: string;
  ariaLabel: string;
  /** Below-the-scroller nodes (comments sheets, report dialogs). */
  footer?: React.ReactNode;
}) {
  // ---- active slide (the IO reports; adapters mirror via callback) ---------
  const [activeIndex, setActiveIndex] = useState(0);

  const feedRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);

  // ---- fill the shell's flex-1 slot (see HEIGHT CONTRACT above) ------------
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [fillHeight, setFillHeight] = useState<number | null>(null);

  useEffect(() => {
    const slot = rootRef.current?.parentElement?.parentElement ?? null;
    if (!slot) return;
    const observer = new ResizeObserver(() => {
      const height = slot.clientHeight;
      if (height > 120) setFillHeight(height);
    });
    // observe() delivers an initial async callback with the first measure
    observer.observe(slot);
    return () => observer.disconnect();
  }, []);

  // ---- active-slide detection (IO threshold 0.6) + last-2-slides paging ----
  useEffect(() => {
    const root = feedRef.current;
    if (!root || state.kind !== "ready" || items.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio < 0.6) continue;
          const idx = Number(
            (entry.target as HTMLElement).dataset.index ?? Number.NaN,
          );
          if (!Number.isFinite(idx) || idx < 0) continue;
          setActiveIndex(idx);
          onActiveIndexChange?.(idx);
          if (idx >= items.length - 2) onEnterLastTwo?.();
        }
      },
      { root, threshold: 0.6 },
    );
    for (const el of slideRefs.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [state, items, onActiveIndexChange, onEnterLastTwo]);

  // ---- navigation -----------------------------------------------------------
  const scrollToIndex = useCallback((index: number) => {
    slideRefs.current[index]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const goNext = useCallback(
    (index: number) => {
      if (index < items.length - 1) scrollToIndex(index + 1);
      else onEnterLastTwo?.();
    },
    [items.length, scrollToIndex, onEnterLastTwo],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (keyboardLocked?.()) return;
      if (event.defaultPrevented) return; // an open menu (the ⋯ dropdown) owns the keys
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      if (event.key === "ArrowDown") goNext(activeIndex);
      else if (activeIndex > 0) scrollToIndex(activeIndex - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, keyboardLocked, goNext, scrollToIndex]);

  // ---- states -----------------------------------------------------------------
  let inner: React.ReactNode;
  if (state.kind === "loading") {
    inner = (
      <div className="flex min-h-[60vh] w-full flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2
          className={`size-8 animate-spin ${state.spinnerClassName ?? "text-yt-red"}`}
          aria-hidden="true"
        />
        <p className="text-sm">{state.label}</p>
      </div>
    );
  } else if (state.kind === "error") {
    inner = (
      <div
        role="alert"
        className="flex min-h-[60vh] w-full flex-1 flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <p className="text-sm text-muted-foreground">{state.message}</p>
        <Button variant="secondary" onClick={() => state.onRetry()}>
          Try again
        </Button>
      </div>
    );
  } else if (state.kind === "empty") {
    inner = (
      <div className="flex min-h-[60vh] w-full flex-1 items-center justify-center px-6">
        <p className="text-center text-sm text-muted-foreground">{state.message}</p>
      </div>
    );
  } else {
    inner = (
      <div
        ref={feedRef}
        role="feed"
        aria-label={ariaLabel}
        aria-busy={loadingMore}
        className="slim-scrollbar min-h-0 w-full flex-1 snap-y snap-mandatory overflow-y-auto overscroll-contain"
      >
        {items.map((item, index) => {
          const control: ShortsSlideControl = {
            index,
            active: index === activeIndex,
            goNext: () => goNext(index),
            goPrev: () => {
              if (index > 0) scrollToIndex(index - 1);
            },
            scrollToIndex,
          };
          return (
            <section
              key={getItemKey(item, index)}
              ref={(el) => {
                slideRefs.current[index] = el;
              }}
              data-index={index}
              aria-label={slideAriaLabel(item, index)}
              className="relative mx-auto flex h-full w-full max-w-[480px] snap-start items-center justify-center"
            >
              {renderSlide(item, control)}
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="relative flex flex-col bg-background"
      style={fillHeight ? { height: fillHeight } : undefined}
    >
      {chrome}
      <div className="flex min-h-0 flex-1 flex-col">{inner}</div>

      {loadingMore && state.kind === "ready" && (
        <div
          className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white/90 backdrop-blur"
          role="status"
        >
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          {loadingMoreLabel}
        </div>
      )}

      {footer}
    </div>
  );
}

/** The desktop prev/next chevron pair (the slides' own geometry renders it —
 * both adapters use the identical markup, so it lives here once). */
export function ShortsSlideChevrons({
  control,
}: {
  control: ShortsSlideControl;
}) {
  return (
    <div className="absolute right-2 top-2 z-20 hidden flex-col gap-2 sm:flex">
      <button
        type="button"
        aria-label="Previous short"
        disabled={control.index === 0}
        onClick={control.goPrev}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-black/50 p-2.5 text-white backdrop-blur transition-transform duration-150 hover:scale-105 focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:pointer-events-none disabled:opacity-30"
      >
        <ChevronUp className="size-5" />
      </button>
      <button
        type="button"
        aria-label="Next short"
        onClick={control.goNext}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-black/50 p-2.5 text-white backdrop-blur transition-transform duration-150 hover:scale-105 focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <ChevronDown className="size-5" />
      </button>
    </div>
  );
}
