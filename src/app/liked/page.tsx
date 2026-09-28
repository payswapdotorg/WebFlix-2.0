"use client";

import Link from "next/link";
import { ThumbsUp } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { VideoDTO } from "@/lib/types";

/** Liked videos — the demo user's VideoLikes (real rows, newest first). */
export default function LikedPage() {
  const { data, loading, error } = useApi<VideoDTO[]>("/api/liked");

  return (
    <div className="pb-6">
      <h1 className="flex items-center gap-2 px-4 py-4 text-xl font-bold sm:px-6 sm:text-2xl">
        <ThumbsUp className="size-7 text-yt-red" /> Liked videos
      </h1>

      {loading && (
        <div className="grid grid-cols-1 gap-x-4 gap-y-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3" aria-hidden="true">
              <Skeleton className="aspect-video w-full rounded-xl" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      )}
      {error && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground" role="alert">
          {error}
        </p>
      )}
      {data && data.length === 0 && (
        <div className="px-4 py-16 text-center sm:px-6">
          <p className="text-lg font-medium">No liked videos yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Videos you like are stored in the database —{" "}
            <Link href="/" className="text-foreground underline underline-offset-2">
              watch something
            </Link>{" "}
            and hit the like button.
          </p>
        </div>
      )}
      {data && data.length > 0 && (
        <div className="grid grid-cols-1 gap-x-4 gap-y-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 2xl:grid-cols-4">
          {data.map((video) => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      )}
    </div>
  );
}
