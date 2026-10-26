import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { TikTokVideoDTO } from "@/lib/tiktok/types";

/**
 * P58 — the TikTok card (ADR 0004 §2): the oEmbed enrichment when the cache
 * holds it, an honest minimal card otherwise (id + embed handoff — never a
 * fake thumbnail). Plain lazy <img> for the thumbnail: TikTok thumbnails ride
 * unpredictable signed-CDN hosts, and next/image's remotePatterns churn buys
 * nothing here (documented residual in the research record §5).
 */
export function TikTokCard({ video }: { video: TikTokVideoDTO }) {
  return (
    <div className="group relative w-[160px] shrink-0" data-testid="tiktok-card">
      <Link
        href={`/tiktok/v/${video.postId}`}
        className="block overflow-hidden rounded-lg bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        aria-label={video.title ? `${video.title} — TikTok` : `TikTok post ${video.postId}`}
      >
        <div className="relative w-full" style={{ aspectRatio: "9 / 16" }}>
          {video.thumbnailUrl ? (
            // Plain <img> by design (ADR 0004 §4): TikTok thumbnails ride
            // unpredictable signed-CDN hosts — no next/image remotePatterns.
            <img
              src={video.thumbnailUrl}
              alt={video.title ? `${video.title} — TikTok` : `TikTok post ${video.postId}`}
              loading="lazy"
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
        {video.title ? (
          <p className="line-clamp-2 text-xs font-medium text-foreground" title={video.title}>
            {video.title}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-1">
          <span className="truncate text-[11px] text-muted-foreground">
            {video.author ? `@${video.author}` : `id ${video.postId}`}
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
