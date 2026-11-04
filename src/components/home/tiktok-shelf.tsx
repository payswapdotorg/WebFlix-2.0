"use client";

import Link from "next/link";
import { Music2 } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { shortsSourceHref } from "@/lib/shorts/feed-contracts";
import {
  tikTokTilePreviewUrl,
  useInViewOnce,
  useTikTokHoverPlay,
  useTikTokOEmbed,
} from "@/components/tiktok/tiktok-preview-client";
import type { TikTokRailDTO, TikTokVideoDTO } from "@/lib/tiktok/types";

/**
 * WFX2-TIKTOK-SHORTS-EXPERIENCE-1 M3 — the home TikTok shelf (the work
 * order's "Search and home" contract): a responsive short-video shelf NEAR
 * the existing home Shorts shelf, deep-linking every card to the selected
 * post in the shared feed (`/shorts?source=tiktok&post=<id>`).
 *
 * Honesty laws:
 * - The data rides /api/tiktok/rail (curated + PUBLIC imports — the M2
 *   composition); the shelf NEVER presents itself as a personalized
 *   recommender — the subtitle names the shelf's actual scope.
 * - The shelf hides gracefully: loading, error and empty all render
 *   NOTHING (the honest absence — never a placeholder row).
 * - Thumbnails ride the plain <img> law (ADR 0004 §4); a metadata-less
 *   post renders the honest fallback tile (the P59-R2 law), never a
 *   fabricated identity. P88: a server-walled lane hydrates the official
 *   CORS-open oEmbed CLIENT-SIDE (the same viewer-side lane the embed
 *   rides) — and still falls back honestly when even that is unreachable.
 * - The tile ladder matches the home ShortsShelf scale (168 → 296), so
 *   the two shelves read as siblings of the one experience.
 * - P88 hover-play: the YouTube shorts-tile contract (450ms dwell, fine
 *   pointers only, muted autoplay, unmount on leave) on TikTok's official
 *   Embed Player — the tap still deep-links into the shared feed.
 */

const TILE_WIDTHS =
  "w-[168px] sm:w-[192px] lg:w-[234px] xl:w-[264px] 2xl:w-[296px]";

function TikTokTile({ postId }: { postId: string }) {
  return (
    <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-secondary">
      <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground">
        <span className="text-xs font-semibold uppercase tracking-wide">TikTok</span>
        <span className="px-2 text-center text-[10px] leading-tight">Post</span>
      </span>
      <span className="sr-only">TikTok post {postId}</span>
    </div>
  );
}

/**
 * One shelf tile — a component of its own because every tile needs its own
 * hydration/hover state (hooks never ride a loop — the ShortsTile law).
 */
function TikTokHomeTile({ video }: { video: TikTokVideoDTO }) {
  const [inViewRef, inView] = useInViewOnce<HTMLDivElement>();
  const meta = useTikTokOEmbed({
    postId: video.postId,
    author: video.author,
    thumbnailUrl: video.thumbnailUrl,
    title: video.title,
    enabled: inView,
  });
  const { hoverProps, previewing } = useTikTokHoverPlay();
  const label = meta.title
    ? `${meta.title} — TikTok`
    : meta.author
      ? `TikTok by @${meta.author}`
      : `TikTok post ${video.postId}`;
  return (
    <Link
      href={shortsSourceHref("tiktok", video.postId)}
      aria-label={label}
      {...hoverProps}
      className={`group flex shrink-0 flex-col gap-2 ${TILE_WIDTHS}`}
      data-testid="tiktok-home-tile"
    >
      <div
        ref={inViewRef}
        className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-secondary"
      >
        {previewing ? (
          // The official Embed Player, muted autoplay + loop; leaving the
          // tile unmounts it (the pause-then-unmount law).
          <iframe
            src={tikTokTilePreviewUrl(video.postId)}
            title={meta.title ? `TikTok preview: ${meta.title}` : `TikTok preview ${video.postId}`}
            data-testid="tiktok-tile-preview"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            className="absolute inset-0 size-full border-0"
          />
        ) : meta.thumbnailUrl ? (
          // Plain <img> by design (ADR 0004 §4) — the TikTokCard law.
          <img
            src={meta.thumbnailUrl}
            alt={label}
            loading="lazy"
            data-testid="tiktok-tile-thumb"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : (
          <TikTokTile postId={video.postId} />
        )}
        {!previewing ? (
          <span className="absolute left-2 top-2 z-10 rounded bg-foreground px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-background">
            TikTok
          </span>
        ) : null}
      </div>
      {meta.title ? (
        <p
          className="line-clamp-2 text-sm font-medium leading-snug text-foreground"
          title={meta.title}
        >
          {meta.title}
        </p>
      ) : null}
      <p className="-mt-1 text-[13px] text-muted-foreground">
        {meta.author ? `@${meta.author}` : `id ${video.postId}`}
      </p>
    </Link>
  );
}

export function TikTokShelf() {
  const { data, error } = useApi<TikTokRailDTO>("/api/tiktok/rail");
  const videos = data?.videos ?? [];

  // The graceful-hide law: no data, an error, or an empty universe renders
  // nothing at all.
  if (error || videos.length === 0) return null;

  return (
    <section aria-label="TikTok shelf" className="mt-2" data-testid="tiktok-home-shelf">
      <h2 className="flex items-center gap-2 px-4 text-lg font-semibold text-foreground sm:px-6 sm:text-xl">
        <Music2 className="size-6" strokeWidth={2.2} /> TikTok
        <span className="text-xs font-normal text-muted-foreground">
          · curated and community-imported posts
        </span>
      </h2>
      <div className="no-scrollbar mt-3 flex gap-4 overflow-x-auto px-4 pb-2 sm:px-6">
        {videos.map((video) => (
          <TikTokHomeTile key={video.postId} video={video} />
        ))}
      </div>
    </section>
  );
}
