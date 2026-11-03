"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ExternalLink, Share2 } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/use-api";
import { ShortsFeedShell, ShortsSlideChevrons } from "@/components/shorts/shorts-feed-shell";
import { ShortsSourceSelector } from "@/components/shorts/shorts-source-selector";
import { TikTokFeedPlayer } from "@/components/tiktok/tiktok-feed-player";
import { SHORTS_SOURCE_CAPABILITIES } from "@/lib/shorts/feed-contracts";
import type { TikTokFeedPageDTO } from "@/lib/tiktok/library";
import type { TikTokVideoDTO } from "@/lib/tiktok/types";

/**
 * ADR 0013 / WFX2-TIKTOK-SHORTS-EXPERIENCE-1 M1 — the TikTok adapter of the
 * one Shorts experience: a real vertical feed of curated TikTok posts played
 * through the OFFICIAL Embed Player under the shared shell's active-slide
 * lifecycle (exactly one iframe exists per feed — the active slide's).
 *
 * Data law: cursor pages from /api/tiktok/feed (the `{ items, nextCursor }`
 * shape law), deduped by post id, capped at MAX_ITEMS; a `post` deep link
 * splices the requested post FIRST on page 1 (any canonical post works —
 * M2's import extends the library, not this feed's mechanics).
 *
 * Action law (the work order's contract §7/§8 + ADR 0013 §5): the rail
 * renders ONLY what the capability map AND this rung's implementation both
 * allow — TikTok has NO official like/comment/follow write API, so the rail
 * ships the honest affordances only: Share (copies the canonical TikTok
 * URL) and Open on TikTok. WebFlix-local save/hide/report land with M2/M3
 * persistence; rendering them now would be fake affordances.
 *
 * Attribution law (contract §6): creator/caption/music render ONLY when the
 * metadata lane verified them — missing fields stay missing, never
 * fabricated. The "TikTok" source label is always truthful (it names the
 * source, not a metric).
 */

const MAX_ITEMS = 60;

const CAPS = SHORTS_SOURCE_CAPABILITIES.tiktok;

async function shareTikTokPost(item: TikTokVideoDTO) {
  const link = item.deepLinkUrl;
  try {
    await navigator.clipboard.writeText(link);
    toast.success("TikTok link copied");
  } catch {
    toast.info(`Copy manually: ${link}`);
  }
}

/** The source-specific action rail (mirrors the YouTube rail's geometry). */
function TikTokFeedRail({ item }: { item: TikTokVideoDTO }) {
  return (
    <div
      className="absolute bottom-16 right-3 z-20 flex flex-col items-center gap-2"
      data-testid="tiktok-shorts-rail"
    >
      {CAPS.canShare ? (
        <button
          type="button"
          onClick={() => void shareTikTokPost(item)}
          aria-label="Share — copy the TikTok link"
          data-testid="tiktok-shorts-share"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-black/30 p-3 text-white backdrop-blur transition-transform duration-150 hover:scale-105 focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <Share2 className="size-full" aria-hidden="true" />
        </button>
      ) : null}
      {CAPS.canOpenOutbound ? (
        <a
          href={item.deepLinkUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open on TikTok"
          data-testid="tiktok-shorts-outbound"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-black/30 p-3 text-white backdrop-blur transition-transform duration-150 hover:scale-105 focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <ExternalLink className="size-full" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}

export function TikTokShortsFeed({ post }: { post?: string | null }) {
  // ---- seed page (deep-link splice happens server-side on page 1) ----------
  const seedUrl = useMemo(
    () =>
      post
        ? `/api/tiktok/feed?post=${encodeURIComponent(post)}`
        : "/api/tiktok/feed",
    [post],
  );
  const {
    data: seedPage,
    loading: seedLoading,
    error: seedError,
    reload: reloadSeed,
  } = useApi<TikTokFeedPageDTO>(seedUrl);

  // ---- cursor pages appended in load order --------------------------------
  const [loadedPages, setLoadedPages] = useState<
    { items: TikTokVideoDTO[]; nextCursor: string | null }[]
  >([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  const seedItems = seedPage?.items ?? [];
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: TikTokVideoDTO[] = [];
    for (const video of [
      ...seedItems,
      ...loadedPages.flatMap((page) => page.items),
    ]) {
      if (seen.has(video.postId)) continue;
      seen.add(video.postId);
      out.push(video);
      if (out.length >= MAX_ITEMS) break;
    }
    return out;
  }, [seedItems, loadedPages]);
  const nextCursor =
    loadedPages.length > 0
      ? loadedPages[loadedPages.length - 1].nextCursor
      : (seedPage?.nextCursor ?? null);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current) return;
    if (!nextCursor || items.length >= MAX_ITEMS) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    fetch(`/api/tiktok/feed?cursor=${encodeURIComponent(nextCursor)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as TikTokFeedPageDTO;
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
            ? `Could not load more TikTok posts (${err.message})`
            : "Could not load more TikTok posts",
        );
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [nextCursor, items.length]);

  const onEnterLastTwo = useCallback(() => {
    loadMore();
  }, [loadMore]);

  const slideAriaLabel = useCallback(
    (item: TikTokVideoDTO) => item.title || (item.author ? `TikTok by @${item.author}` : "TikTok post"),
    [],
  );

  const state = seedLoading
    ? ({ kind: "loading", label: "Loading TikTok feed", spinnerClassName: "text-foreground" } as const)
    : seedError
      ? ({ kind: "error", message: `TikTok feed failed: ${seedError}`, onRetry: () => reloadSeed() } as const)
      : items.length === 0
        ? ({
            kind: "empty",
            message:
              "No TikTok posts in the curated shelf yet. Canonical post URLs arrive through the hub and import (M2) — the official player already rides.",
          } as const)
        : ({ kind: "ready" } as const);

  return (
    <ShortsFeedShell<TikTokVideoDTO>
      state={state}
      ariaLabel="TikTok feed"
      chrome={<ShortsSourceSelector source="tiktok" />}
      items={items}
      getItemKey={(item) => item.postId}
      slideAriaLabel={slideAriaLabel}
      onEnterLastTwo={onEnterLastTwo}
      loadingMore={loadingMore}
      loadingMoreLabel="Loading more TikToks"
      renderSlide={(item, control) => (
        <>
          {/* 9:16 player column — the SAME geometry wrapper as YouTube's
              slides (the one-experience law) */}
          <div className="relative aspect-[9/16] h-full w-auto max-w-full">
            <TikTokFeedPlayer item={item} active={control.active} />

            {/* bottom-left attribution overlay (gradient) — verified fields
                only, never fabricated (the work order's contract §6) */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 via-black/25 to-transparent p-4 pt-14">
              <div className="min-w-0 pr-16">
                <div className="flex items-center gap-2" data-testid="tiktok-shorts-attribution">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-[13px] font-bold text-white" aria-hidden="true">
                    ♪
                  </span>
                  {item.author ? (
                    item.authorUrl ? (
                      <a
                        href={item.authorUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pointer-events-auto w-fit truncate text-sm font-semibold text-white transition-opacity hover:opacity-80"
                      >
                        @{item.author}
                      </a>
                    ) : (
                      <span className="truncate text-sm font-semibold text-white">
                        @{item.author}
                      </span>
                    )
                  ) : null}
                  <span className="ml-auto rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    TikTok
                  </span>
                </div>

                {item.title ? (
                  <p className="mt-2 line-clamp-3 text-sm font-medium text-white/90" data-testid="tiktok-shorts-caption">
                    {item.title}
                  </p>
                ) : null}
              </div>
            </div>

            <TikTokFeedRail item={item} />

            {/* desktop prev/next chevrons (the shared pair) */}
            <ShortsSlideChevrons control={control} />
          </div>
        </>
      )}
    />
  );
}
