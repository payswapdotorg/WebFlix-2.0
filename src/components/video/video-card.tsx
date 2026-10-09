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
import { addToQueue } from "@/lib/queue/queue-actions";
import { useWebFlixSession } from "@/hooks/use-webflix-session";
import { signInHref } from "@/lib/auth/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatDuration, displayViews, displayPublished, watchProgress, isUpcomingPremiere, formatPremiereDate } from "@/lib/format";
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
  /**
   * WFX2-P7-AN — the watched-map entry for this video (videoId → watchedSec
   * from POST /api/watch/watched-map). When provided, the thumbnail carries
   * the WATCHED strip (YouTube's already-watched idiom). Surfaces without a
   * map simply don't pass it — never a per-card fetch.
   */
  watchedSec?: number;
};

/** WebFlix video card: thumbnail + duration badge, 2-line title, meta, kebab. */
export function VideoCard({ video, progress, variant = "grid", className, watchedSec: watchedMapSec }: VideoCardProps) {
  const [hidden, setHidden] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const hover = useHoverPreview(video);
  // WFX2-P4-QT seam (lead-wired at merge): the hover menu's Add to queue
  // now rides the REAL WL-backed queue — never a fake append.
  const wfSession = useWebFlixSession();

  if (hidden) return null;

  const watched =
    "watchedSec" in video ? watchProgress(video.watchedSec, video.durationSec ?? 0) : 0;
  const shownProgress = progress ?? watched;
  // P21-LIVE-PREMIERES: the card's premiere state — scheduled (premieredAt
  // future) carries YouTube's PREMIERE badge + the scheduled date text in
  // the meta line (no views/age — none exist before the premiere starts).
  const upcomingPremiere = isUpcomingPremiere(video);

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

  // WFX2-P4-QT: the AU guest gate, then the real watch-later write FIRST
  // (queue-actions) — the session queue only gains the item after the
  // server confirms; honest outcomes only.
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
      className={cn(
        "group/card flex flex-col",
        // P12-UX Task 2: rails use the SAME full-size card as the grid
        // (youtube.com's shelf items ≈ 320-400px, measured min-width ~330px).
        variant === "rail" && "w-[320px] shrink-0 sm:w-[360px]",
        className
      )}
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
          ) : upcomingPremiere ? (
            <span className="duration-badge absolute bottom-1.5 right-1.5 rounded-sm px-1.5 py-0.5 text-[11px] font-bold uppercase">
              Premiere
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
          {watchedMapSec !== undefined && (
            <span
              data-testid="video-card-watched"
              className="absolute bottom-0 left-0 right-0 bg-neutral-900/80 px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white"
            >
              Watched
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
          <Avatar className="size-9">
            {video.channel.avatarUrl ? (
              <AvatarImage src={video.channel.avatarUrl} alt="" />
            ) : null}
            <AvatarFallback>{video.channel.name.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
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
            {upcomingPremiere && video.premieredAt ? (
              formatPremiereDate(video.premieredAt)
            ) : (
              <>
                {displayViews(video)}
                {(() => {
                  const age = displayPublished(video);
                  return age ? ` · ${age}` : "";
                })()}
              </>
            )}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`More options for ${video.title}`}
              // P12-UX: ≥44px touch target on touch devices, compact 32px on desktop pointers
              className="h-11 w-11 shrink-0 rounded-full opacity-0 transition-opacity focus-visible:opacity-100 group-hover/card:opacity-100 data-[state=open]:opacity-100 sm:h-8 sm:w-8"
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
