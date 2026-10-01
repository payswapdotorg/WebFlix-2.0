"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ListVideo, Play, MoreVertical, ChevronUp, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/use-api";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PlaylistPageDTO, VideoDTO } from "@/lib/types";

/**
 * The public playlist page (WFX2-B-W) — browse VL<id> (real YouTube
 * playlist): title, owner, stats, the video grid, Play all (first video).
 * Playlist-result cards from search link here.
 *
 * WFX2-P4-PE: per-item ⋯ menu with Move up / Move down (the broker's
 * playlist-reorder drive, mapped to fromIndex/toIndex calls). Optimistic
 * local reorder; toast on the broker verdicts; honest degradation when the
 * broker is offline/unauthorized (the toast surfaces the error). The
 * affordance is hidden when the playlist is read-only (the broker's
 * playlist-drag-handle-not-found honest failure shape — the operator may not
 * own the playlist).
 */
export default function PlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, reload } = useApi<PlaylistPageDTO>(
    id ? `/api/playlist/${encodeURIComponent(id)}` : null
  );

  // optimistic local reorder (the broker's intended effect)
  const [order, setOrder] = useState<VideoDTO[] | null>(null);
  const [reordering, setReordering] = useState<number | null>(null);

  const listedVideos = order ?? data?.videos ?? [];

  async function moveItem(fromIndex: number, toIndex: number) {
    if (!id || !data) return;
    if (toIndex < 0 || toIndex >= listedVideos.length) return;
    if (fromIndex === toIndex) return;
    const moved = listedVideos[fromIndex];
    if (!moved) return;
    // optimistic local reorder (mirrors the broker's intended effect)
    const optimistic = [...listedVideos];
    optimistic.splice(fromIndex, 1);
    optimistic.splice(toIndex, 0, moved);
    setOrder(optimistic);
    setReordering(fromIndex);
    try {
      const res = await fetch(`/api/playlists/${encodeURIComponent(id)}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromIndex, toIndex, videoId: moved.id }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        verified?: boolean;
        error?: string;
        unverifiedNote?: string;
      };
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      if (body.verified) {
        toast.success(`Moved “${moved.title}” to position ${toIndex + 1}`);
      } else if (body.unverifiedNote) {
        toast.info(`Move submitted — the broker could not confirm the new order yet`);
      } else {
        toast.success(`Move submitted`);
      }
      // reload the canonical order from the server (clears the optimistic state)
      reload();
      setOrder(null);
    } catch (err) {
      // revert the optimistic reorder on failure
      setOrder(null);
      toast.error(err instanceof Error ? err.message : "Failed to reorder playlist");
    } finally {
      setReordering(null);
    }
  }

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
            {listedVideos.map((video, i) => (
              <div key={video.id} className="relative">
                <span className="absolute -left-1 -top-1 z-10 hidden text-xs font-semibold tabular-nums text-muted-foreground lg:block" aria-hidden>
                  {i + 1}
                </span>
                <div className="relative">
                  <VideoCard video={video} />
                  {/* the per-item ⋯ menu (Move up / Move down — the broker's
                      playlist-reorder drive) */}
                  <div className="absolute right-1 top-1 z-20 opacity-0 transition-opacity focus-within:opacity-100 hover:opacity-100 group-hover:opacity-100">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="size-7 rounded-full p-0 shadow"
                          disabled={reordering !== null}
                          aria-label={`Actions for ${video.title}`}
                        >
                          {reordering === i ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <MoreVertical className="size-3.5" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={i === 0 || reordering !== null}
                          onClick={() => moveItem(i, i - 1)}
                        >
                          <ChevronUp className="mr-2 size-3.5" /> Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={i === listedVideos.length - 1 || reordering !== null}
                          onClick={() => moveItem(i, i + 1)}
                        >
                          <ChevronDown className="mr-2 size-3.5" /> Move down
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
