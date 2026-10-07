"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { useWebFlixSession } from "@/hooks/use-webflix-session";
import { ReportDialog } from "@/components/watch/report-dialog";
import { ShortsPlayerSlot } from "./shorts-player-slot";
import { ShortsEngagementRail } from "./shorts-engagement-rail";
import { ShortsCommentsSheet } from "./shorts-comments-sheet";
import type {
  ShortDTO,
  ShortMetaDTO,
  ShortsFeedDTO,
} from "@/lib/youtube/shorts";

/**
 * WFX2-A-S (agent WFX2-A-S-FRONTEND-B) — Shorts vertical feed.
 *
 * Full-height snap-scroll feed (the shell's main column must NOT scroll —
 * this component owns the scrolling via `h-full snap-y snap-mandatory`).
 * All DATA flows through the /api routes (seed + cursor pages + per-short
 * meta hydration); the only youtube.com client calls are the Tier-3 embed
 * iframe and i.ytimg.com poster hotlinks inside ShortsPlayerSlot.
 *
 * Behavior:
 * - Seed via the shared useApi hook (lint-clean derived loading state);
 *   cursor pages GET /api/shorts?cursor=… are appended (deduped by id,
 *   capped at MAX_ITEMS) when the active slide enters the last 2 slides
 *   (IntersectionObserver callback) or ArrowDown/chevron is pressed on
 *   the last slide.
 * - Active slide via IntersectionObserver (threshold 0.6) — drives player
 *   autoplay + lazy meta hydration (GET /api/shorts/{id} once per id).
 * - Keyboard ArrowUp/ArrowDown, wheel + touch = natural snap scroll,
 *   desktop chevrons. Share copies the internal /watch/{id} link.
 *
 * P15-SHORTS: the feed owns the WebFlix session probe (one fetch — the rail
 * instances receive `guest` as a prop) and the report dialog state for the
 * rail's More (⋯) menu (the watch report dialog, read-only reuse).
 *
 * HEIGHT CONTRACT: the AppShell wraps page children in a plain `div.flex-1`
 * whose used height comes from flexing — percentage heights (h-full) do NOT
 * resolve against it (classic flex-item gotcha, verified in-browser). The
 * feed therefore MEASURES that slot (page.tsx renders div.h-full >
 * ShortsFeed, so the slot is the feed root's grandparent) with a
 * ResizeObserver and applies it as an explicit height. The footer stays
 * visible at the bottom and main never scrolls — the feed is the scroller.
 */

const MAX_ITEMS = 60;
const EMPTY_ITEMS: ShortDTO[] = [];

export function ShortsFeed() {
  // ---- WebFlix session (ONE probe for the whole feed; guests never write) --
  const wfSession = useWebFlixSession();
  const guest = wfSession.status === "unauthenticated";

  // ---- seed page (shared fetch hook: loading is derived, no setState in effect)
  const {
    data: seedPage,
    loading: seedLoading,
    error: seedError,
    reload: reloadSeed,
  } = useApi<ShortsFeedDTO>("/api/shorts");

  // ---- cursor pages appended in load order --------------------------------
  const [loadedPages, setLoadedPages] = useState<
    { items: ShortDTO[]; nextCursor: string | null }[]
  >([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  const seedItems = seedPage?.items ?? EMPTY_ITEMS;
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: ShortDTO[] = [];
    for (const short of [
      ...seedItems,
      ...loadedPages.flatMap((page) => page.items),
    ]) {
      if (seen.has(short.id)) continue;
      seen.add(short.id);
      out.push(short);
      if (out.length >= MAX_ITEMS) break;
    }
    return out;
  }, [seedItems, loadedPages]);
  const nextCursor =
    loadedPages.length > 0
      ? loadedPages[loadedPages.length - 1].nextCursor
      : (seedPage?.nextCursor ?? null);

  // ---- active slide + hydration -------------------------------------------
  const [activeIndex, setActiveIndex] = useState(0);
  const [metas, setMetas] = useState<Record<string, ShortMetaDTO>>({});
  const [failedIds, setFailedIds] = useState<Record<string, boolean>>({});
  const [commentsFor, setCommentsFor] = useState<string | null>(null);
  const [reportFor, setReportFor] = useState<string | null>(null);

  const feedRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);
  const inflightMetaRef = useRef<Set<string>>(new Set());

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

  // ---- cursor paging (triggered from the observer callback / user events) --
  const loadMore = useCallback(() => {
    if (loadingMoreRef.current) return;
    if (!nextCursor || items.length >= MAX_ITEMS) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    fetch(`/api/shorts?cursor=${encodeURIComponent(nextCursor)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as ShortsFeedDTO;
      })
      .then((page) => {
        setLoadedPages((prev) => [
          ...prev,
          { items: page.items, nextCursor: page.nextCursor },
        ]);
      })
      .catch((err: unknown) => {
        toast.error(
          err instanceof Error
            ? `Could not load more shorts (${err.message})`
            : "Could not load more shorts",
        );
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [nextCursor, items.length]);

  // ---- active-slide detection (IO threshold 0.6) + last-2-slides paging ----
  useEffect(() => {
    const root = feedRef.current;
    if (!root || items.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio < 0.6) continue;
          const idx = Number(
            (entry.target as HTMLElement).dataset.index ?? Number.NaN,
          );
          if (!Number.isFinite(idx) || idx < 0) continue;
          setActiveIndex(idx);
          if (idx >= items.length - 2) loadMore();
        }
      },
      { root, threshold: 0.6 },
    );
    for (const el of slideRefs.current) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [items, loadMore]);

  // ---- per-short meta hydration (active slide, fetched once per id) --------
  useEffect(() => {
    const id = items[activeIndex]?.id;
    if (!id) return;
    if (metas[id] || failedIds[id] || inflightMetaRef.current.has(id)) return;
    inflightMetaRef.current.add(id);
    fetch(`/api/shorts/${id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as ShortMetaDTO;
      })
      .then((meta) => {
        setMetas((prev) => ({ ...prev, [id]: meta }));
      })
      .catch(() => {
        setFailedIds((prev) => ({ ...prev, [id]: true }));
      })
      .finally(() => {
        inflightMetaRef.current.delete(id);
      });
  }, [activeIndex, items, metas, failedIds]);

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
      else loadMore();
    },
    [items.length, scrollToIndex, loadMore],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (commentsFor !== null || reportFor !== null) return; // sheet/dialog owns the keyboard
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
  }, [activeIndex, commentsFor, reportFor, goNext, scrollToIndex]);

  // ---- share (internal /watch link) -----------------------------------------
  async function shareShort(id: string) {
    const link = `${window.location.origin}/watch/${id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied");
    } catch {
      toast.info(`Copy manually: ${link}`);
    }
  }

  // ---- states -----------------------------------------------------------------
  let inner: React.ReactNode;
  if (seedLoading) {
    inner = (
      <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 text-white/80">
        <Loader2
          className="size-8 animate-spin text-yt-red"
          aria-hidden="true"
        />
        <p className="text-sm">Loading shorts</p>
      </div>
    );
  } else if (seedError) {
    inner = (
      <div
        role="alert"
        className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <p className="text-sm text-white/80">Shorts feed failed: {seedError}</p>
        <Button variant="secondary" onClick={() => reloadSeed()}>
          Try again
        </Button>
      </div>
    );
  } else if (items.length === 0) {
    inner = (
      <div className="flex h-full min-h-[60vh] items-center justify-center px-6">
        <p className="text-center text-sm text-white/70">
          No shorts found right now.
        </p>
      </div>
    );
  } else {
    inner = (
      <>
        <div
          ref={feedRef}
          role="feed"
          aria-label="Shorts feed"
          aria-busy={loadingMore}
          className="slim-scrollbar h-full snap-y snap-mandatory overflow-y-auto overscroll-contain"
        >
          {items.map((item, index) => {
            const hydrated = metas[item.id] ?? null;
            const failedMeta = failedIds[item.id] ?? false;
            const display: ShortDTO | null = hydrated
              ? {
                  ...hydrated,
                  title: hydrated.title || item.title,
                  viewsText: hydrated.viewsText ?? item.viewsText,
                }
              : item.title
                ? item
                : null;
            const channel = display?.channel ?? null;
            const hasChannel =
              channel !== null && Boolean(channel.name || channel.handle);

            return (
              <section
                key={item.id}
                ref={(el) => {
                  slideRefs.current[index] = el;
                }}
                data-index={index}
                aria-label={display?.title || "Short"}
                className="relative mx-auto flex h-full w-full max-w-[480px] snap-start items-center justify-center"
              >
                {/* 9:16 player column — geometry wrapper the overlays track */}
                <div className="relative aspect-[9/16] h-full w-auto max-w-full">
                  <ShortsPlayerSlot
                    videoId={item.id}
                    active={index === activeIndex}
                    posterUrl={display?.thumbnailUrl ?? null}
                  />

                  {/* bottom-left info overlay (gradient) */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 via-black/25 to-transparent p-4 pt-14">
                    <div className="min-w-0 pr-16">
                      {hasChannel && channel ? (
                        channel.handle ? (
                          <Link
                            href={`/channel/${channel.handle}`}
                            aria-label={`Go to ${channel.name ?? channel.handle}`}
                            className="pointer-events-auto flex w-fit items-center gap-2 rounded-full transition-opacity hover:opacity-80"
                          >
                            <img
                              src={channel.avatarUrl ?? ""}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              className="size-8 shrink-0 rounded-full bg-white/10 object-cover"
                            />
                            <span className="truncate text-sm font-semibold text-white">
                              {channel.name ?? channel.handle}
                            </span>
                          </Link>
                        ) : (
                          <div className="flex items-center gap-2">
                            <img
                              src={channel.avatarUrl ?? ""}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              className="size-8 shrink-0 rounded-full bg-white/10 object-cover"
                            />
                            <span className="truncate text-sm font-semibold text-white">
                              {channel.name}
                            </span>
                          </div>
                        )
                      ) : (
                        <div
                          className="flex items-center gap-2"
                          aria-hidden="true"
                        >
                          <Skeleton className="size-8 rounded-full bg-white/15" />
                          <Skeleton className="h-4 w-28 rounded bg-white/15" />
                        </div>
                      )}

                      {display?.title ? (
                        <p className="mt-2 line-clamp-2 text-sm font-medium text-white/90">
                          {display.title}
                        </p>
                      ) : failedMeta ? (
                        <p className="mt-2 text-sm text-white/60">
                          Details unavailable
                        </p>
                      ) : (
                        <Skeleton
                          className="mt-2 h-4 w-4/5 rounded bg-white/15"
                          aria-hidden="true"
                        />
                      )}

                      {display?.viewsText ? (
                        <p className="mt-1 text-xs text-white/70">
                          {display.viewsText}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <ShortsEngagementRail
                    videoId={item.id}
                    meta={display}
                    metaLoading={!hydrated && !failedMeta}
                    guest={guest}
                    onOpenComments={() => setCommentsFor(item.id)}
                    onShare={() => void shareShort(item.id)}
                    onReport={() => setReportFor(item.id)}
                  />

                  {/* desktop prev/next chevrons (above the rail) */}
                  <div className="absolute right-2 top-2 z-20 hidden flex-col gap-2 sm:flex">
                    <button
                      type="button"
                      aria-label="Previous short"
                      disabled={index === 0}
                      onClick={() => scrollToIndex(index - 1)}
                      className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-black/50 p-2.5 text-white backdrop-blur transition-transform duration-150 hover:scale-105 focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:pointer-events-none disabled:opacity-30"
                    >
                      <ChevronUp className="size-5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Next short"
                      onClick={() => goNext(index)}
                      className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-black/50 p-2.5 text-white backdrop-blur transition-transform duration-150 hover:scale-105 focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                    >
                      <ChevronDown className="size-5" />
                    </button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        {loadingMore && (
          <div
            className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white/90 backdrop-blur"
            role="status"
          >
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Loading more
          </div>
        )}
      </>
    );
  }

  return (
    <div
      ref={rootRef}
      className="relative bg-black"
      style={fillHeight ? { height: fillHeight } : undefined}
    >
      {inner}
      <ShortsCommentsSheet
        videoId={commentsFor ?? items[activeIndex]?.id ?? ""}
        meta={commentsFor !== null ? (metas[commentsFor] ?? null) : null}
        open={commentsFor !== null}
        onClose={() => setCommentsFor(null)}
        guest={guest}
      />
      {/* the ⋯ menu's Report action — the watch report dialog (read-only
          reuse; conditional mount → fresh state per open, the watch-page law) */}
      {reportFor !== null && (
        <ReportDialog
          open
          onOpenChange={(open) => {
            if (!open) setReportFor(null);
          }}
          videoId={reportFor}
        />
      )}
    </div>
  );
}
