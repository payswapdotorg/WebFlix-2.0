"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { shortsSourceHref } from "@/lib/shorts/feed-contracts";
import {
  tikTokTilePreviewUrl,
  useInViewOnce,
  useTikTokHoverPlay,
  useTikTokOEmbed,
} from "@/components/tiktok/tiktok-preview-client";
import type { TikTokVideoDTO } from "@/lib/tiktok/types";

/**
 * P58 — the TikTok card (ADR 0004 §2): the oEmbed enrichment when the cache
 * holds it, an honest minimal card otherwise (id + embed handoff — never a
 * fake thumbnail). Plain lazy <img> for the thumbnail: TikTok thumbnails ride
 * unpredictable signed-CDN hosts, and next/image's remotePatterns churn buys
 * nothing here (documented residual in the research record §5).
 *
 * WFX2-TIKTOK-SHORTS-EXPERIENCE-1 M3 — the deep-link pass: the card opens
 * the shared Shorts feed AT that post (`/shorts?source=tiktok&post=<id>`,
 * the canonical in-app href law) — direct, no legacy `/tiktok/v/<id>` hop
 * (that route remains the compatibility redirect only). Every surface that
 * renders this card (hub, search, home shelf) deep-links the same way.
 *
 * P88 — the client preview lane: a server-walled metadata lane hydrates the
 * official CORS-open oEmbed in the viewer's browser (thumbnail + title +
 * author fill — never fabricated), and a fine-pointer hover with a 450ms
 * dwell mounts the official Embed Player muted-autoplaying; leaving the
 * card unmounts it (the pause-then-unmount law). The tap still deep-links.
 */
export function TikTokCard({ video }: { video: TikTokVideoDTO }) {
  const [inViewRef, inView] = useInViewOnce<HTMLDivElement>();
  const meta = useTikTokOEmbed({
    postId: video.postId,
    author: video.author,
    thumbnailUrl: video.thumbnailUrl,
    title: video.title,
    enabled: inView,
  });
  const { hoverProps, previewing } = useTikTokHoverPlay();
  const label = meta.title ? `${meta.title} — TikTok` : `TikTok post ${video.postId}`;
  return (
    <div
      className="group relative w-[160px] shrink-0"
      data-testid="tiktok-card"
      {...hoverProps}
    >
      <Link
        href={shortsSourceHref("tiktok", video.postId)}
        className="block overflow-hidden rounded-lg bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        aria-label={label}
      >
        <div ref={inViewRef} className="relative w-full" style={{ aspectRatio: "9 / 16" }}>
          {previewing ? (
            // The official Embed Player, muted autoplay + loop; leaving the
            // card unmounts it (the pause-then-unmount law).
            <iframe
              src={tikTokTilePreviewUrl(video.postId)}
              title={meta.title ? `TikTok preview: ${meta.title}` : `TikTok preview ${video.postId}`}
              data-testid="tiktok-card-preview"
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
              className="absolute inset-0 size-full border-0"
            />
          ) : meta.thumbnailUrl ? (
            // Plain <img> by design (ADR 0004 §4): TikTok thumbnails ride
            // unpredictable signed-CDN hosts — no next/image remotePatterns.
            <img
              src={meta.thumbnailUrl}
              alt={label}
              loading="lazy"
              data-testid="tiktok-card-thumb"
              className="absolute inset-0 size-full object-cover transition-opacity group-hover:opacity-90"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-muted text-muted-foreground">
              <span className="text-xs font-semibold uppercase tracking-wide">TikTok</span>
              <span className="px-2 text-center text-[10px] leading-tight">
                {video.unavailable ? "Metadata unavailable — embed still plays" : "Post"}
              </span>
            </div>
          )}
        </div>
      </Link>
      <div className="mt-1.5 space-y-0.5">
        {meta.title ? (
          <p className="line-clamp-2 text-xs font-medium text-foreground" title={meta.title}>
            {meta.title}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-[11px] text-muted-foreground">
            {meta.author ? `@${meta.author}` : `id ${video.postId}`}
          </span>
          <a
            href={video.deepLinkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Open on TikTok"
          >
            <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
