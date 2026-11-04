"use client";

import Link from "next/link";
import { Music2 } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { shortsSourceHref } from "@/lib/shorts/feed-contracts";
import type { TikTokRailDTO } from "@/lib/tiktok/types";

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
 *   fabricated identity.
 * - The tile ladder matches the home ShortsShelf scale (168 → 296), so
 *   the two shelves read as siblings of the one experience.
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
          <Link
            key={video.postId}
            href={shortsSourceHref("tiktok", video.postId)}
            aria-label={
              video.title
                ? `${video.title} — TikTok`
                : video.author
                  ? `TikTok by @${video.author}`
                  : `TikTok post ${video.postId}`
            }
            className={`group flex shrink-0 flex-col gap-2 ${TILE_WIDTHS}`}
            data-testid="tiktok-home-tile"
          >
            <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-secondary">
              {video.thumbnailUrl ? (
                // Plain <img> by design (ADR 0004 §4) — the TikTokCard law.
                <img
                  src={video.thumbnailUrl}
                  alt={video.title ? `${video.title} — TikTok` : `TikTok post ${video.postId}`}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                />
              ) : (
                <TikTokTile postId={video.postId} />
              )}
              <span className="absolute left-2 top-2 z-10 rounded bg-foreground px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-background">
                TikTok
              </span>
            </div>
            {video.title ? (
              <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground" title={video.title}>
                {video.title}
              </p>
            ) : null}
            <p className="-mt-1 text-[13px] text-muted-foreground">
              {video.author ? `@${video.author}` : `id ${video.postId}`}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
