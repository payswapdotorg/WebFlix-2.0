"use client";

import { useState } from "react";
import Link from "next/link";
import { BookmarkPlus, MoreVertical, Share2, Ban, ListPlus } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useHoverPreview } from "@/components/video/video-hover-preview";
import { addToQueue } from "@/lib/queue/queue-actions";
import { useWebFlixSession } from "@/hooks/use-webflix-session";
import { signInHref } from "@/lib/auth/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatDuration, displayViews, displayPublished } from "@/lib/format";
import { postJson } from "@/hooks/use-api";
import { VerifiedBadge } from "@/components/app/verified-badge";
import { cn } from "@/lib/utils";
import type { VideoDTO } from "@/lib/types";

/**
 * P13-SEARCH — youtube.com's search-result video card (dedicated shape —
 * search cards are horizontal list cards, NOT the home grid card).
 *
 * Measured on live youtube.com (2026-10-06, 1440px viewport):
 *   thumbnail 500×281 (16:9) left at wide columns, 360px on narrower ones,
 *   full-width above metadata on mobile; metadata block right: 2-line
 *   clamped 18px title, meta line (views · age), channel row (24px avatar,
 *   bold name, verified badge), 2-line grey description snippet.
 *
 * Hover: the shared VideoHoverPreviewLayer follows the card's
 * [data-thumb-anchor] — the SAME preview pipeline as the home grid (embed
 * mini player → storyboard fallback), tracked on this card's thumbnail rect.
 */
export function SearchVideoCard({ video, className }: { video: VideoDTO; className?: string }) {
  const hover = useHoverPreview(video);
  const wfSession = useWebFlixSession();
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

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

  async function copyLink() {
    const link = `${window.location.origin}/watch/${video.id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied to clipboard");
    } catch {
      toast.info(`Copy manually: ${link}`);
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

  async function onAddToQueue() {
    if (wfSession.status !== "authenticated") {
      window.location.assign(signInHref(`/watch/${video.id}`));
      return;
    }
    const outcome = await addToQueue({
      videoId: video.id,
      title: video.title,
      channelName: video.channel.name,
      thumbnailUrl: video.thumbnailUrl ?? null,
      durationSec: video.durationSec ?? 0,
    });
    if (outcome.status === "appended") toast.success("Added to queue");
    else if (outcome.status === "already-queued") toast.info("Already in the queue");
    else if (outcome.status === "full") toast.info("The queue is full");
    else if (outcome.status === "error") toast.error(outcome.message);
  }

  return (
    <article
      data-testid="search-video-card"
      className={cn("group/search flex flex-col gap-3 sm:flex-row sm:gap-4", className)}
      onMouseEnter={hover.onMouseEnter}
      onMouseLeave={hover.onMouseLeave}
    >
      <Link
        href={`/watch/${video.id}`}
        aria-label={`Watch ${video.title}`}
        className="relative block w-full shrink-0 overflow-hidden rounded-xl bg-secondary sm:w-[360px] xl:w-[500px]"
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
          ) : video.durationSec !== null ? (
            <span className="duration-badge absolute bottom-1.5 right-1.5 rounded-sm px-1.5 py-0.5 text-[11px] font-medium tabular-nums">
              {formatDuration(video.durationSec)}
            </span>
          ) : null}
          {video.isMembersOnly && (
            <span className="absolute left-1.5 top-1.5 rounded-sm bg-yt-red px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Members
            </span>
          )}
        </div>
      </Link>

      <div className="min-w-0 flex-1">
        <Link href={`/watch/${video.id}`} className="block">
          <h3
            title={video.title}
            className="line-clamp-2 text-lg font-normal leading-snug text-foreground"
          >
            {video.title}
          </h3>
        </Link>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[13px] text-muted-foreground">
          {displayViews(video)}
          {(() => {
            const age = displayPublished(video);
            return age ? ` · ${age}` : "";
          })()}
        </p>
        <Link
          href={`/channel/${video.channel.handle}`}
          className="mt-2 flex w-fit items-center gap-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Avatar className="size-6">
            {video.channel.avatarUrl ? <AvatarImage src={video.channel.avatarUrl} alt="" /> : null}
            <AvatarFallback className="text-[10px]">
              {video.channel.name.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="font-medium text-foreground/90">{video.channel.name}</span>
          {video.channel.verified && <VerifiedBadge />}
        </Link>
        {video.description && (
          <p className="mt-2 line-clamp-2 hidden text-[13px] leading-snug text-muted-foreground sm:block">
            {video.description}
          </p>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`More options for ${video.title}`}
            className="h-11 w-11 shrink-0 self-start rounded-full opacity-0 transition-opacity focus-visible:opacity-100 group-hover/search:opacity-100 data-[state=open]:opacity-100 sm:h-9 sm:w-9"
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
          <DropdownMenuItem onSelect={copyLink}>
            <Share2 className="size-4" /> Share
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={notInterested}>
            <Ban className="size-4" /> Not interested
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  );
}
