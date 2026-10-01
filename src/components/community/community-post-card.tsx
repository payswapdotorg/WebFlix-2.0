"use client";

/**
 * WFX2-P2-SO — one community post card (youtube.com community parity):
 * author avatar/name/time, text, image (single + grid), poll (options with
 * vote bars + total votes — read-only vote display), like/dislike + counts
 * (broker post-like), comment count → expandable comments (paged, sorted),
 * and share (the real youtube.com/post/<id> URL).
 *
 * Honest states everywhere: broker-offline → toast + state rollback; the
 * walled comments read → the unavailable note, never fake zero-comment
 * threads.
 */
import { useState } from "react";
import { Heart, MessageCircle, Share2, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { postJson } from "@/hooks/use-api";
import { formatCount } from "@/lib/format";
import type { CommunityPostDTO } from "@/lib/types";
import { PostComments } from "./post-comments";

/** Parse a compact count label ("4.4K" / "1,234") → number. */
function parseCompact(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = label.replace(/,/g, "").match(/([\d.]+)\s*(K|M|B)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "B"] ?? 1;
  return Math.round(n * mult);
}

interface LikeResponse {
  ok: true;
  effect: string;
  likes: number;
  yourLike: "like" | "dislike" | null;
}

export function CommunityPostCard({
  post,
  channelAvatarUrl,
  channelName,
  channelHandle,
}: {
  post: CommunityPostDTO;
  channelAvatarUrl: string | null;
  channelName: string;
  /** the channel page's handle (share links fall back to it) */
  channelHandle: string;
}) {
  const [yourLike, setYourLike] = useState<"like" | "dislike" | null>(null);
  const [likes, setLikes] = useState<number | null>(parseCompact(post.likesText));
  const [likeBusy, setLikeBusy] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentCount, setCommentCount] = useState<number | null>(
    parseCompact(post.replyCountText)
  );
  const [shareOpen, setShareOpen] = useState(false);

  const avatar = post.authorAvatarUrl || channelAvatarUrl;
  const authorName = post.authorName || channelName;
  const images = post.images && post.images.length ? post.images : post.imageUrl ? [post.imageUrl] : [];

  async function sendLike(next: "like" | "dislike") {
    if (likeBusy) return;
    const prev = { yourLike, likes };
    // optimistic flip (YouTube's own feel); rolled back on failure
    const toggling = yourLike === next;
    const target = toggling ? null : next;
    setYourLike(target);
    if (likes !== null) {
      setLikes(
        next === "like"
          ? toggling
            ? Math.max(0, likes - 1)
            : prev.yourLike === "dislike"
              ? likes + 1
              : likes + 1
          : Math.max(0, likes - (prev.yourLike === "like" ? 1 : 0))
      );
    }
    setLikeBusy(true);
    try {
      const res = await postJson<LikeResponse>(`/api/posts/${encodeURIComponent(post.id)}/like`, {
        value: next,
        baseline: { likes: prev.likes ?? 0, yourLike: prev.yourLike },
      });
      setYourLike(res.yourLike);
      setLikes(res.likes);
    } catch (err) {
      setYourLike(prev.yourLike);
      setLikes(prev.likes);
      toast.error(err instanceof Error ? err.message : "Could not update the post rating");
    } finally {
      setLikeBusy(false);
    }
  }

  const shareUrl = `https://www.youtube.com/post/${encodeURIComponent(post.id)}`;

  async function share() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Post link copied to clipboard");
    } catch {
      setShareOpen(true);
      toast.info(`Post link: ${shareUrl}`);
    }
  }

  return (
    <article
      className="rounded-xl border border-border bg-background p-4 sm:p-5"
      aria-label={`Community post by ${authorName}`}
    >
      <header className="flex items-center gap-3">
        {avatar ? (
          <img
            src={avatar}
            alt={`${authorName} avatar`}
            className="size-10 rounded-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex size-10 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
            {authorName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{authorName}</p>
          {post.publishedText && (
            <p className="text-xs text-muted-foreground">{post.publishedText}</p>
          )}
        </div>
      </header>

      {post.text && (
        <p className="mt-3 whitespace-pre-line break-words text-sm leading-relaxed">
          {post.text}
        </p>
      )}

      {images.length > 0 && (
        <div
          className={cn(
            "mt-3 gap-2 overflow-hidden",
            images.length === 1 ? "rounded-xl" : "grid grid-cols-2 rounded-xl"
          )}
        >
          {images.slice(0, 4).map((url, i) => (
            <div
              key={`${url}-${i}`}
              className={cn(
                "relative overflow-hidden bg-secondary",
                images.length === 1 ? "max-h-[36rem]" : "aspect-square"
              )}
            >
              <img
                src={url}
                alt={images.length === 1 ? "Post image" : `Post image ${i + 1}`}
                loading="lazy"
                className={cn(
                  "object-cover",
                  images.length === 1 ? "h-full max-h-[36rem] w-full" : "absolute inset-0 h-full w-full"
                )}
              />
            </div>
          ))}
          {images.length > 4 && (
            <div className="relative col-span-2 flex aspect-video items-center justify-center bg-secondary/80 text-sm font-medium text-secondary-foreground">
              + {images.length - 4} more images
            </div>
          )}
        </div>
      )}

      {post.poll && (
        <div className="mt-3 space-y-2" aria-label="Poll">
          {post.poll.choices.map((choice, i) => {
            const pct =
              choice.percentText && /^[\d.]+%$/.test(choice.percentText)
                ? Number(choice.percentText.replace("%", ""))
                : pollPercent(choice, post.poll!);
            return (
              <div
                key={`${choice.text}-${i}`}
                className="relative overflow-hidden rounded-lg border border-border"
              >
                {pct !== null && (
                  <div
                    className="absolute inset-y-0 left-0 bg-secondary"
                    style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                    aria-hidden="true"
                  />
                )}
                <div className="relative flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 break-words">{choice.text}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {choice.percentText ??
                      (pct !== null ? `${Math.round(pct)}%` : choice.votes !== null ? formatCount(choice.votes) : "")}
                  </span>
                </div>
              </div>
            );
          })}
          {post.poll.totalVotesText && (
            <p className="text-xs text-muted-foreground">{post.poll.totalVotesText}</p>
          )}
          {!post.poll.totalVotesText && post.poll.totalVotes !== null && (
            <p className="text-xs text-muted-foreground">
              {formatCount(post.poll.totalVotes)} votes
            </p>
          )}
        </div>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
                    onClick={() => void sendLike("like")}
          disabled={likeBusy}
          aria-pressed={yourLike === "like"}
          aria-label={yourLike === "like" ? "Unlike post" : "Like post"}
          className={cn("rounded-full gap-1.5", yourLike === "like" && "text-primary")}
        >
          <ThumbsUp className="size-4" aria-hidden="true" />
          {likes !== null && <span className="text-xs tabular-nums">{formatCount(likes)}</span>}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
                    onClick={() => void sendLike("dislike")}
          disabled={likeBusy}
          aria-pressed={yourLike === "dislike"}
          aria-label={yourLike === "dislike" ? "Remove dislike" : "Dislike post"}
          className={cn("rounded-full gap-1.5", yourLike === "dislike" && "text-primary")}
        >
          <ThumbsDown className="size-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
                    onClick={() => setCommentsOpen((v) => !v)}
          aria-expanded={commentsOpen}
          aria-label={`${commentCount ?? ""} comments`}
          className="rounded-full gap-1.5"
        >
          <MessageCircle className="size-4" aria-hidden="true" />
          {commentCount !== null && (
            <span className="text-xs tabular-nums">{formatCount(commentCount)}</span>
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
                    onClick={() => void share()}
          aria-label="Share post"
          className="rounded-full gap-1.5"
        >
          <Share2 className="size-4" aria-hidden="true" />
          <span className="text-xs">Share</span>
        </Button>
        {shareOpen && (
          <p className="w-full break-all text-xs text-muted-foreground" role="status">
            {shareUrl}
          </p>
        )}
      </footer>

      {commentsOpen && (
        <PostComments
          postId={post.id}
          onCountLoaded={(n) => setCommentCount(n)}
        />
      )}
    </article>
  );
}

/** Poll choice percentage fallback: votes / total (null when unknowable). */
function pollPercent(
  choice: { votes: number | null },
  poll: { choices: { votes: number | null }[]; totalVotes: number | null }
): number | null {
  const total =
    poll.totalVotes ?? poll.choices.reduce<number | null>((acc, c) => {
      if (acc === null || c.votes === null) return null;
      return acc + c.votes;
    }, 0);
  if (total === null || total <= 0 || choice.votes === null) return null;
  return (choice.votes / total) * 100;
}

export function CommunityPostSkeleton() {
  return (
    <div className="space-y-3 rounded-xl border border-border p-4" aria-busy="true">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}
