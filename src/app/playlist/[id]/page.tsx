"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ListVideo, Play } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import type { PlaylistPageDTO } from "@/lib/types";

/**
 * The public playlist page (WFX2-B-W) — browse VL<id> (real YouTube
 * playlist): title, owner, stats, the video grid, Play all (first video).
 * Playlist-result cards from search link here.
 */
export default function PlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error } = useApi<PlaylistPageDTO>(
    id ? `/api/playlist/${encodeURIComponent(id)}` : null
  );

  if (error) {
    return (
      <div className="px-4 py-16 text-center sm:px-6" role="alert">
        <p className="text-lg font-medium">Playlist not found</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Link href="/" className="mt-4 inline-block text-sm underline underline-offset-2">
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="pb-10">
      {loading && (
        <div className="space-y-4 px-4 py-6 sm:px-6" aria-busy="true">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <div className="grid grid-cols-1 gap-x-4 gap-y-8 pt-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-video w-full rounded-xl" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            ))}
          </div>
        </div>
      )}
      {data && (
        <>
          <div className="flex flex-col gap-3 px-4 py-5 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <ListVideo className="size-4" aria-hidden />
                {data.playlist.id.startsWith("RD") ? "Mix" : "Playlist"}
              </p>
              <h1 className="mt-1 text-xl font-bold sm:text-2xl">{data.playlist.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {data.playlist.channelName}
                {data.playlist.videoCountText ? ` · ${data.playlist.videoCountText}` : ""}
                {data.playlist.viewsText ? ` · ${data.playlist.viewsText}` : ""}
              </p>
              {data.playlist.description && (
                <p className="mt-2 line-clamp-2 max-w-2xl text-sm text-muted-foreground">
                  {data.playlist.description}
                </p>
              )}
            </div>
            {data.videos.length > 0 && (
              <Button asChild className="w-fit gap-2 rounded-full">
                <Link href={`/watch/${data.videos[0].id}`}>
                  <Play className="size-4" aria-hidden />
                  {data.videos.length > 1 ? "Play all" : "Play"}
                </Link>
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 2xl:grid-cols-4">
            {data.videos.map((video, i) => (
              <div key={video.id} className="relative">
                <span className="absolute -left-1 -top-1 z-10 hidden text-xs font-semibold tabular-nums text-muted-foreground lg:block" aria-hidden>
                  {i + 1}
                </span>
                <VideoCard video={video} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
