"use client";

import Link from "next/link";
import { ThumbsUp } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { VideoDTO } from "@/lib/types";
import { PersonalSurfaceGate } from "@/components/auth/personal-surface-gate";

type LikedPayload = {
  videos: VideoDTO[];
  nextCursor: string | null;
  loginRequired: boolean;
  session: boolean;
};

/** Liked videos — the operator's REAL Liked playlist (YouTube's own `LL`).
 * WFX2-P2-AU: guests get the youtube.com signed-out screen (the gate). */
export default function LikedPage() {
  return (
    <PersonalSurfaceGate surface="liked">
      <LikedContent />
    </PersonalSurfaceGate>
  );
}

function LikedContent() {
  const { data, loading, error } = useApi<LikedPayload>("/api/liked");
  const videos = data?.videos ?? [];

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
      {data && data.loginRequired && (
        <div className="px-4 py-16 text-center sm:px-6">
          <p className="text-lg font-medium">Sign in to see your liked videos</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Liked videos are personal — they read from the YouTube account this WebFlix
            session rides (single-tenant live mode). No session is configured right now.
          </p>
        </div>
      )}
      {data && !data.loginRequired && videos.length === 0 && (
        <div className="px-4 py-16 text-center sm:px-6">
          <p className="text-lg font-medium">No liked videos yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Likes live on the YouTube account —{" "}
            <Link href="/" className="text-foreground underline underline-offset-2">
              watch something
            </Link>{" "}
            and hit the like button.
          </p>
        </div>
      )}
      {videos.length > 0 && (
        <div className="grid grid-cols-1 gap-x-4 gap-y-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 2xl:grid-cols-4">
          {videos.map((video) => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      )}
    </div>
  );
}
