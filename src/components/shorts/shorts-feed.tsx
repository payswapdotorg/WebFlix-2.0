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
import { hashtagHref } from "@/lib/watch/chapters";
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
  // ---- live-shorts lane (2026-10-16 operator pass): All | Live chips -----
  // youtube.com's shorts surfaces mix live vertical streams into the feed
  // (the mobile app's "browse through live shorts"); live items carry the
  // red LIVE badge + concurrent viewers, and the Live chip filters the
  // loaded feed to them (the honest client-side filter over the genuine
  // live flags — the sequence's LIVE overlay style + per-short hydration).
  const [live, setLive] = useState(false);

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
    // the Live chip's honest client filter (sequence LIVE-overlay flags +
    // hydrated "N watching" signals — never a title-word guess)
    return live ? out.filter((s) => s.isLive === true) : out;
  }, [seedItems, loadedPages, live]);
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
      <div className="flex min-h-[60vh] w-full flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2
          className="size-8 animate-spin text-yt-red"
          aria-hidden="true"
        />
        <p className="text-sm">Loading {live ? "live shorts" : "shorts"}</p>
      </div>
    );
  } else if (seedError) {
    inner = (
      <div
        role="alert"
        className="flex min-h-[60vh] w-full flex-1 flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <p className="text-sm text-muted-foreground">Shorts feed failed: {seedError}</p>
        <Button variant="secondary" onClick={() => reloadSeed()}>
          Try again
        </Button>
      </div>
    );
  } else if (items.length === 0) {
    inner = (
      <div className="flex min-h-[60vh] w-full flex-1 items-center justify-center px-6">
        <p className="text-center text-sm text-muted-foreground">
          {live
            ? "No live shorts in this feed right now — check All, or swipe the general feed (live shorts ride it too)."
            : "No shorts found right now."}
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
          className="slim-scrollbar min-h-0 w-full flex-1 snap-y snap-mandatory overflow-y-auto overscroll-contain"
        >
          {items.map((item, index) => {
            const hydrated = metas[item.id] ?? null;
            const failedMeta = failedIds[item.id] ?? false;
            const display: ShortDTO | null = hydrated
              ? {
                  ...hydrated,
                  title: hydrated.title || item.title,
                  viewsText: hydrated.viewsText ?? item.viewsText,
                  // live flag: the hydrated verdict wins, the sequence's
                  // LIVE-overlay flag rides until hydration lands
                  isLive: hydrated.isLive ?? item.isLive,
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
                    isLive={display?.isLive ?? false}
                  />

                  {/* LIVE badge (mobile-app parity): red pill + dot, top-left
                      over the player — youtube.com's own live shorts chrome */}
                  {display?.isLive ? (
                    <div
                      data-testid="shorts-live-badge"
                      aria-label="Live now"
                      className="pointer-events-none absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded bg-yt-red px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white"
                    >
                      <span
                        className="size-1.5 animate-pulse rounded-full bg-white"
                        aria-hidden="true"
                      />
                      Live
                    </div>
                  ) : null}

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
                          <ShortsTitle title={display.title} />
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
                          {display.isLive && !/watch/i.test(display.viewsText)
                            ? `${display.viewsText} watching now`
                            : display.viewsText}
                        </p>
                      ) : display?.isLive ? (
                        <p className="mt-1 text-xs text-white/70">Watching now</p>
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
      className="relative flex flex-col bg-background"
      style={fillHeight ? { height: fillHeight } : undefined}
    >
      {/* All | Live chips (2026-10-16 operator pass — browse live shorts,
          youtube mobile-app parity). Theme-aware row above the feed. */}
      <div
        role="tablist"
        aria-label="Shorts feed filter"
        className="flex shrink-0 items-center gap-2 px-4 py-2 sm:px-6"
      >
        <button
          type="button"
          role="tab"
          aria-selected={!live}
          onClick={() => setLive(false)}
          className={
            "rounded-full px-3 py-1 text-xs font-medium transition-colors " +
            (!live
              ? "bg-foreground text-background"
              : "bg-secondary text-secondary-foreground hover:bg-accent")
          }
        >
          All
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={live}
          onClick={() => setLive(true)}
          className={
            "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors " +
            (live
              ? "bg-yt-red text-white"
              : "bg-secondary text-secondary-foreground hover:bg-accent")
          }
        >
          <span
            className={"size-1.5 rounded-full " + (live ? "bg-white" : "bg-yt-red")}
            aria-hidden="true"
          />
          Live
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{inner}</div>
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

/**
 * REA-1 G17 — the shorts title with hashtag tokens routed to youtube.com's
 * DEDICATED /hashtag/<tag> browse surface (measured live 2026-10-17 —
 * shorts titles carry #token links that resolve there). The same token
 * family as the watch description (parseHashtags' regex); plain text stays
 * plain. Minimal + additive: only the title render changes.
 */
const HASHTAG_TOKEN_RE = /(#[\p{L}\p{N}_-]+)/gu;

function ShortsTitle({ title }: { title: string }) {
  const parts = title.split(HASHTAG_TOKEN_RE);
  if (parts.length <= 1) return <>{title}</>;
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 && part.startsWith("#") ? (
          <Link
            key={`${part}-${i}`}
            href={hashtagHref(part)}
            data-testid="shorts-hashtag"
            className="font-semibold text-white hover:underline"
          >
            {part}
          </Link>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}
