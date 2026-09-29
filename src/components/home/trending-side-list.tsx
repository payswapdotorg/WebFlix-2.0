"use client";

import Link from "next/link";
import { formatViews, formatRelativeDate } from "@/lib/format";
import { VerifiedBadge } from "@/components/app/verified-badge";
import type { VideoDTO } from "@/lib/types";

/** Compact "Trending now" list beside the hero (ZTube right rail). */
export function TrendingSideList({ videos }: { videos: VideoDTO[] }) {
  if (videos.length === 0) return null;
  return (
    <aside
      aria-label="Trending now list"
      className="rounded-2xl border border-border/60 bg-secondary/30 p-4"
    >
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        ⚡ Trending now
      </h2>
      <ol className="space-y-3">
        {videos.map((video, i) => (
          <li key={video.id}>
            <Link
              href={`/watch/${video.id}`}
              className="flex gap-3 rounded-lg p-1 transition-colors hover:bg-accent/50"
            >
              <span className="w-4 shrink-0 pt-0.5 text-sm font-semibold text-muted-foreground tabular-nums">
                {i + 1}
              </span>
              <div className="relative aspect-video w-[136px] shrink-0 overflow-hidden rounded-lg bg-secondary sm:w-[168px]">
                <img
                  src={video.thumbnailUrl}
                  alt={video.title}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                  {video.title}
                </h3>
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="truncate">{video.channel.name}</span>
                  {video.channel.verified && <VerifiedBadge />}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatViews(video.views)} · {formatRelativeDate(video.createdAt)}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </aside>
  );
}
