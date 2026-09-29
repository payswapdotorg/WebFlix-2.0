"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Bell, BookmarkPlus, Check, Crown, Share2, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { useApi, postJson } from "@/hooks/use-api";
import { VideoCard } from "@/components/video/video-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { VerifiedBadge } from "@/components/app/verified-badge";
import { PlaylistSaveDialog } from "@/components/video/playlist-save-dialog";
import {
  formatViews,
  formatRelativeDate,
  formatCount,
  formatSubscribers,
} from "@/lib/format";
import type { WatchPageDTO } from "@/lib/types";

/**
 * Watch — minimal-but-wired: HTML5 player with progress resume, honest
 * like/dislike, subscribe, save, share, related rail, comments preview.
 * The complete watch vertical (chapters, transcript, full comments,
 * miniplayer, autoplay-next) is WFX2-W.
 */
export default function WatchPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, reload } = useApi<WatchPageDTO>(id ? `/api/watch/${id}` : null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Engagement state: API value + local override after user actions
  // (derived state — no setState-in-effect sync).
  const [rating, setRating] = useState<"like" | "dislike" | null>(null);
  const [engagement, setEngagement] = useState<{
    likes: number;
    dislikes: number;
  } | null>(null);
  const [subscribedOverride, setSubscribedOverride] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  const likes = engagement?.likes ?? data?.video.likes ?? 0;
  const dislikes = engagement?.dislikes ?? data?.video.dislikes ?? 0;
  const subscribed = subscribedOverride ?? data?.isSubscribed ?? false;

  // Record watch progress (5s initial, every 15s, and on unmount).
  useEffect(() => {
    if (!data || !id) return;
    let stopped = false;
    const send = (sec: number) => {
      if (stopped || sec < 5) return;
      void fetch("/api/view", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: id, watchedSec: Math.floor(sec) }),
        keepalive: true,
      }).catch(() => undefined);
    };
    const timer = setInterval(() => {
      if (videoRef.current && !videoRef.current.paused) {
        send(videoRef.current.currentTime);
      }
    }, 15_000);
    return () => {
      stopped = true;
      clearInterval(timer);
      if (videoRef.current) send(videoRef.current.currentTime);
    };
  }, [data, id]);

  async function rate(value: "like" | "dislike") {
    if (!id) return;
    const next = rating === value ? null : value;
    try {
      const res = await postJson<{ likes: number; dislikes: number; yourRating: "like" | "dislike" | null }>(
        `/api/videos/${id}/like`,
        { value: next }
      );
      setRating(res.yourRating);
      setEngagement({ likes: res.likes, dislikes: res.dislikes });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rate");
    }
  }

  async function toggleSubscribe() {
    if (!data) return;
    try {
      const res = await postJson<{ subscribed: boolean }>("/api/subscribe", {
        channelId: data.video.channel.id,
      });
      setSubscribedOverride(res.subscribed);
      toast.success(res.subscribed ? "Subscribed" : "Unsubscribed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update subscription");
    }
  }

  async function share() {
    if (!id) return;
    const link = `${window.location.origin}/watch/${id}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copied to clipboard");
    } catch {
      toast.info(`Copy manually: ${link}`);
    }
  }

  async function saveWatchLater() {
    if (!id) return;
    try {
      const res = await postJson<{ added: boolean }>("/api/playlists/watch-later", { videoId: id });
      toast.success(res.added ? "Saved to Watch later" : "Already in Watch later");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    }
  }

  if (error) {
    return (
      <div className="px-4 py-16 text-center sm:px-6" role="alert">
        <p className="text-lg font-medium">Video unavailable</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Link href="/" className="mt-4 inline-block text-sm underline underline-offset-2">
          Back to home
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px]">
      {loading && (
        <div className="grid gap-6 p-4 sm:px-6 xl:grid-cols-[minmax(0,1fr)_402px]" aria-busy="true">
          <div className="space-y-4">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="aspect-video w-[168px] rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && (
        <div className="grid gap-6 p-4 sm:px-6 xl:grid-cols-[minmax(0,1fr)_402px]">
          <div className="min-w-0">
            {/* player */}
            <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
              <video
                ref={videoRef}
                src={data.video.videoUrl}
                poster={data.video.thumbnailUrl}
                controls
                playsInline
                className="h-full w-full"
                aria-label={data.video.title}
              />
            </div>

            {/* title + engagement */}
            <h1 className="mt-4 text-lg font-bold leading-snug sm:text-xl">{data.video.title}</h1>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-4">
                <Link href={`/channel/${data.video.channel.handle}`} className="shrink-0">
                  <img
                    src={data.video.channel.avatarUrl}
                    alt={data.video.channel.name}
                    className="size-10 rounded-full object-cover"
                  />
                </Link>
                <div className="min-w-0">
                  <Link
                    href={`/channel/${data.video.channel.handle}`}
                    className="flex items-center gap-1 text-base font-medium hover:text-muted-foreground"
                  >
                    <span className="truncate">{data.video.channel.name}</span>
                    {data.video.channel.verified && <VerifiedBadge />}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {formatSubscribers(data.video.channel.subscriberCount)}
                  </p>
                </div>
                {!data.isOwner && (
                  <Button
                    onClick={toggleSubscribe}
                    variant={subscribed ? "secondary" : "default"}
                    className={`ml-2 rounded-full ${
                      subscribed ? "bg-secondary hover:bg-accent" : "bg-foreground text-background hover:bg-foreground/90"
                    }`}
                  >
                    {subscribed ? (
                      <>
                        <Bell className="mr-2 size-4" /> Subscribed
                      </>
                    ) : (
                      "Subscribe"
                    )}
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center overflow-hidden rounded-full bg-secondary">
                  <button
                    type="button"
                    onClick={() => rate("like")}
                    aria-pressed={rating === "like"}
                    aria-label="Like this video"
                    className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors hover:bg-accent ${
                      rating === "like" ? "text-primary" : ""
                    }`}
                  >
                    <ThumbsUp className="size-4" /> {formatCount(likes)}
                  </button>
                  <Separator orientation="vertical" className="h-6 bg-border" />
                  <button
                    type="button"
                    onClick={() => rate("dislike")}
                    aria-pressed={rating === "dislike"}
                    aria-label="Dislike this video"
                    className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors hover:bg-accent ${
                      rating === "dislike" ? "text-primary" : ""
                    }`}
                  >
                    <ThumbsDown className="size-4" />
                    <span className="sr-only sm:not-sr-only">{formatCount(dislikes)}</span>
                  </button>
                </div>
                <Button variant="secondary" className="rounded-full" onClick={share}>
                  <Share2 className="mr-2 size-4" /> Share
                </Button>
                <Button
                  variant="secondary"
                  className="hidden rounded-full sm:inline-flex"
                  onClick={saveWatchLater}
                >
                  <BookmarkPlus className="mr-2 size-4" /> Save
                </Button>
              </div>
            </div>

            {/* description */}
            <div className="mt-4 rounded-xl bg-secondary/40 p-4 text-sm">
              <p className="font-medium">
                {formatViews(data.video.views)} · {formatRelativeDate(data.video.createdAt)}
                {data.video.isLive && (
                  <span className="ml-2 rounded-sm bg-yt-red px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                    Live
                  </span>
                )}
              </p>
              {data.video.isMembersOnly && (
                <p className="mt-2 flex items-center gap-1.5 text-sm text-foreground">
                  <Crown className="size-4 text-yellow-500" />
                  Members-only video{" "}
                  {data.memberTierName ? (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      — you're a {data.memberTierName} <Check className="size-3.5" />
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      — join the channel membership to watch
                    </span>
                  )}
                </p>
              )}
              <p
                className={`mt-2 whitespace-pre-line text-muted-foreground ${
                  expanded ? "" : "line-clamp-2"
                }`}
              >
                {data.video.description || "No description."}
              </p>
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="mt-2 text-sm font-medium text-foreground hover:underline"
                aria-expanded={expanded}
              >
                {expanded ? "Show less" : "…more"}
              </button>
            </div>

            {/* comments (preview — full vertical is WFX2-W) */}
            <section aria-label="Comments" className="mt-6">
              <h2 className="text-base font-semibold">
                {formatCount(data.comments.length)} comment
                {data.comments.length === 1 ? "" : "s"}
              </h2>
              <div className="mt-4 space-y-5">
                {data.comments.length === 0 && (
                  <p className="py-4 text-sm text-muted-foreground">
                    No comments yet — the comment experience ships with WFX2-W.
                  </p>
                )}
                {data.comments.map((c) => (
                  <article key={c.id} className="flex gap-4">
                    <img src={c.author.avatarUrl} alt="" className="size-10 shrink-0 rounded-full object-cover" />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">@{c.author.handle}</span>{" "}
                        {formatRelativeDate(c.createdAt)}
                        {c.pinned && (
                          <span className="ml-2 rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase">
                            Pinned
                          </span>
                        )}
                      </p>
                      <p className="mt-1 whitespace-pre-line text-sm">{c.body}</p>
                      <p className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <ThumbsUp className="size-3.5" /> {formatCount(c.likes)}
                        {c.heartedByCreator && <span title="Hearted by creator">❤️</span>}
                        {c.replyCount > 0 && <>· {c.replyCount} replies</>}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>

          {/* related rail */}
          <aside aria-label="Related videos" className="min-w-0">
            <h2 className="pb-2 text-base font-semibold">Related</h2>
            <div className="space-y-3">
              {data.related.map((video) => (
                <RelatedCard key={video.id} video={video} />
              ))}
            </div>
          </aside>
        </div>
      )}

      {data && (
        <PlaylistSaveDialog
          open={saveOpen}
          onOpenChange={setSaveOpen}
          videoId={id}
          videoTitle={data.video.title}
        />
      )}
    </div>
  );
}

function RelatedCard({ video }: { video: WatchPageDTO["related"][number] }) {
  return (
    <Link href={`/watch/${video.id}`} className="group flex gap-3 rounded-xl p-1 transition-colors hover:bg-accent/40">
      <div className="relative aspect-video w-[168px] shrink-0 overflow-hidden rounded-lg bg-secondary">
        <img
          src={video.thumbnailUrl}
          alt={video.title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug">{video.title}</h3>
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <span className="truncate">{video.channel.name}</span>
          {video.channel.verified && <VerifiedBadge />}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatViews(video.views)} · {formatRelativeDate(video.createdAt)}
        </p>
      </div>
    </Link>
  );
}
