"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Ban,
  BookmarkPlus,
  ListPlus,
  MoreVertical,
  Share2,
  ListVideo,
  Link2,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useHoverPreview } from "./video-hover-preview";
import { PlaylistSaveDialog } from "./playlist-save-dialog";
import { useQueue } from "@/lib/sidebar-store";
import { formatDuration, formatViews, formatRelativeDate, watchProgress } from "@/lib/format";
import { cn } from "@/lib/utils";
import { postJson } from "@/hooks/use-api";
import { VerifiedBadge } from "@/components/app/verified-badge";
import type { ContinueVideoDTO, VideoDTO } from "@/lib/types";

type VideoCardProps = {
  video: VideoDTO | ContinueVideoDTO;
  /** progress override 0..1 (continue watching); omitted → computed from watchedSec */
  progress?: number;
  variant?: "grid" | "rail";
  className?: string;
};

/** WebFlix video card: thumbnail + duration badge, 2-line title, meta, kebab. */
export function VideoCard({ video, progress, variant = "grid", className }: VideoCardProps) {
  const [hidden, setHidden] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const hover = useHoverPreview(video);
  const addToQueue = useQueue((s) => s.addToQueue);

  if (hidden) return null;

  const watched =
    "watchedSec" in video ? watchProgress(video.watchedSec, video.durationSec) : 0;
  const shownProgress = progress ?? watched;

  async function copyLink() {
    const link = `${window.location.origin}/watch/${video.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied to clipboard");
    } catch {
      toast.info(`Copy manually: ${link}`);
    }
  }

  async function saveWatchLater() {
    try {
      const res = await postJson<{ added: boolean }>("/api/playlists/watch-later", {
        videoId: video.id,
      });
      toast.success(res.added ? "Saved to Watch later" : "Already in Watch later");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  }

  async function notInterested() {
    try {
      await postJson("/api/not-interested", { videoId: video.id });
      setHidden(true);
      toast("Got it — we'll show fewer videos like this");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to hide video");
    }
  }

  function onAddToQueue() {
    const added = addToQueue(video.id);
    toast[added ? "success" : "info"](added ? "Added to queue" : "Already in the queue");
  }

  return (
    <article
      className={cn("group/card flex flex-col", variant === "rail" && "w-[240px] shrink-0", className)}
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
    >
      <Link
        href={`/watch/${video.id}`}
        aria-label={`Watch ${video.title}`}
        className="relative block overflow-hidden rounded-xl bg-secondary"
      >
        <div data-thumb-anchor="" className="relative aspect-video w-full">
          <img
            src={video.thumbnailUrl}
            alt={video.title}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {video.isLive ? (
            <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-sm bg-yt-red px-1.5 py-0.5 text-[11px] font-bold uppercase text-white">
              <span className="size-1.5 rounded-full bg-white" /> Live
            </span>
          ) : (
            <span className="duration-badge absolute bottom-1.5 right-1.5 rounded-sm px-1.5 py-0.5 text-[11px] font-medium tabular-nums">
              {formatDuration(video.durationSec)}
            </span>
          )}
          {video.isMembersOnly && (
            <span className="absolute left-1.5 top-1.5 rounded-sm bg-yt-red px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Members
            </span>
          )}
          {shownProgress > 0 && (
            <Progress
              value={shownProgress * 100}
              className="absolute bottom-0 left-0 h-1 w-full rounded-none bg-white/30"
              aria-label={`Watched ${Math.round(shownProgress * 100)}%`}
            />
          )}
        </div>
      </Link>

      <div className="mt-3 flex gap-3">
        <Link
          href={`/channel/${video.channel.handle}`}
          aria-label={`Go to ${video.channel.name}`}
          className="hidden shrink-0 sm:block"
          tabIndex={-1}
        >
          <img
            src={video.channel.avatarUrl}
            alt=""
            loading="lazy"
            className="size-9 rounded-full object-cover"
          />
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={`/watch/${video.id}`} className="block">
            <h3
              title={video.title}
              className="line-clamp-2 text-sm font-medium leading-snug text-foreground"
            >
              {video.title}
            </h3>
          </Link>
          <Link
            href={`/channel/${video.channel.handle}`}
            className="mt-1 flex w-fit items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="truncate">{video.channel.name}</span>
            {video.channel.verified && <VerifiedBadge />}
          </Link>
          <p className="text-[13px] text-muted-foreground">
            {formatViews(video.views)} · {formatRelativeDate(video.createdAt)}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`More options for ${video.title}`}
              className="h-8 w-8 shrink-0 rounded-full opacity-0 transition-opacity focus-visible:opacity-100 group-hover/card:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={onAddToQueue}>
              <ListPlus className="size-4" /> Add to queue
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={saveWatchLater}>
              <BookmarkPlus className="size-4" /> Save to Watch later
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSaveOpen(true)}>
              <ListVideo className="size-4" /> Save to playlist
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={copyLink}>
              <Share2 className="size-4" /> Share
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={notInterested}>
              <Ban className="size-4" /> Not interested
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/watch/${video.id}`} className="cursor-pointer">
                <Link2 className="size-4" /> Go to video
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <PlaylistSaveDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        videoId={video.id}
        videoTitle={video.title}
      />
    </article>
  );
}
