"use client";

import { ChevronRight, Clock } from "lucide-react";
import Link from "next/link";
import { VideoCard } from "@/components/video/video-card";
import type { ContinueVideoDTO, VideoDTO } from "@/lib/types";

/** A horizontal rail of cards ("Trending now", "Continue watching", …). */
export function VideoRail({
  title,
  videos,
  icon,
  moreHref,
  moreLabel = "More",
  railLabel,
}: {
  title: string;
  videos: (VideoDTO | ContinueVideoDTO)[];
  icon?: React.ReactNode;
  moreHref?: string;
  moreLabel?: string;
  railLabel?: string;
}) {
  if (videos.length === 0) return null;
  return (
    <section aria-label={railLabel ?? title} className="mt-8">
      <div className="flex items-center justify-between px-4 sm:px-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground sm:text-xl">
          {icon}
          {title}
        </h2>
        {moreHref && (
          <Link
            href={moreHref}
            className="flex items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {moreLabel} <ChevronRight className="size-4" />
          </Link>
        )}
      </div>
      <div className="no-scrollbar mt-3 flex gap-4 overflow-x-auto px-4 pb-2 sm:px-6">
        {videos.map((video) => (
          <VideoCard key={`${video.id}-${railLabel ?? title}`} video={video} variant="rail" />
        ))}
      </div>
    </section>
  );
}

/** "Continue watching" rail header (clock icon). */
export function ContinueWatchingRail({ videos }: { videos: ContinueVideoDTO[] }) {
  return (
    <VideoRail
      title="Continue watching"
      videos={videos}
      icon={<Clock className="size-5 text-muted-foreground" />}
      moreHref="/history"
      moreLabel="History"
      railLabel="Continue watching rail"
    />
  );
}
