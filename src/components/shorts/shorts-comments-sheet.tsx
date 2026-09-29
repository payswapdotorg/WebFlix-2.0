"use client";

import { Heart, Pin, ThumbsUp } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { VerifiedBadge } from "@/components/app/verified-badge";
import type { ShortCommentDTO, ShortMetaDTO } from "@/lib/youtube/shorts";

/**
 * WFX2-A-S (agent WFX2-A-S-FRONTEND-B) — Shorts comments bottom sheet.
 *
 * Mobile-first bottom sheet (Sheet side="bottom"; on sm+ it caps to a
 * centered max-w column — the base Sheet's `side` prop is not responsive,
 * so it stays a bottom drawer at every breakpoint, per the honest-simple
 * option). Data comes from the parent feed (hydrated via /api/shorts/[id]).
 *
 * HONEST PAGING NOTE: this lane exposes only the FIRST comments page
 * (meta.comments). There is no further-comments endpoint in the shorts
 * lane, so when meta.commentsNextToken exists we render a muted
 * "More replies on YouTube" note instead of a fake load-more button.
 *
 * Per-comment likes/replies are display-only (interactions land with
 * WFX2-D). Escape closes (Sheet handles it); the handle bar is a
 * swipe-down affordance visual.
 */

function CommentRow({ comment }: { comment: ShortCommentDTO }) {
  return (
    <li className="flex gap-3 py-3">
      <img
        src={comment.authorAvatarUrl ?? ""}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className="size-9 shrink-0 rounded-full bg-secondary object-cover"
      />
      <div className="min-w-0 flex-1">
        {comment.pinned && (
          <p className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Pin className="size-3" aria-hidden="true" /> Pinned
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-medium text-foreground/90">
            {comment.authorName}
          </span>
          {comment.isVerified && <VerifiedBadge />}
          {comment.publishedTime && (
            <span className="text-xs text-muted-foreground">
              {comment.publishedTime}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm leading-snug text-foreground/90 break-words whitespace-pre-wrap">
          {comment.body}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {comment.likesText && (
            <span
              className="flex items-center gap-1.5"
              aria-label={`${comment.likesText} likes on this comment`}
            >
              <ThumbsUp className="size-3.5" aria-hidden="true" />
              {comment.likesText}
            </span>
          )}
          {comment.replyCount > 0 && (
            <span>
              {comment.replyCount}{" "}
              {comment.replyCount === 1 ? "reply" : "replies"}
            </span>
          )}
          {comment.heartedByCreator && (
            <span className="flex items-center gap-1" title="Loved by creator">
              <Heart
                className="size-3 fill-yt-red text-yt-red"
                aria-hidden="true"
              />
              Loved by creator
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function CommentSkeletonRow() {
  return (
    <li className="flex gap-3 py-3" aria-hidden="true">
      <Skeleton className="size-9 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3.5 w-full max-w-64" />
        <Skeleton className="h-3.5 w-40" />
      </div>
    </li>
  );
}

export function ShortsCommentsSheet({
  videoId,
  meta,
  open,
  onClose,
}: {
  videoId: string;
  meta: ShortMetaDTO | null;
  open: boolean;
  onClose: () => void;
}) {
  const comments = meta?.comments ?? null;

  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <SheetContent
        side="bottom"
        className="h-[88dvh] gap-0 p-0 sm:mx-auto sm:max-w-xl sm:rounded-t-2xl"
      >
        {/* Swipe-down affordance */}
        <div className="flex justify-center pt-2" aria-hidden="true">
          <div className="h-1.5 w-10 rounded-full bg-muted-foreground/40" />
        </div>
        <SheetHeader className="flex-row items-center gap-2 border-b px-4 py-3 pr-12">
          <SheetTitle className="text-base">Comments</SheetTitle>
          {meta?.commentsCountText ? (
            <span className="text-sm text-muted-foreground">
              {meta.commentsCountText}
            </span>
          ) : null}
        </SheetHeader>
        <SheetDescription className="sr-only">
          Comments for short {videoId}
        </SheetDescription>

        <div className="slim-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {comments === null ? (
            <ul role="list" aria-label="Loading comments">
              {Array.from({ length: 5 }).map((_, i) => (
                <CommentSkeletonRow key={i} />
              ))}
            </ul>
          ) : comments.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No comments yet.
            </p>
          ) : (
            <>
              <ul role="list" aria-label="Comments">
                {comments.map((comment) => (
                  <CommentRow key={comment.id} comment={comment} />
                ))}
              </ul>
              {meta?.commentsNextToken ? (
                <p className="border-t py-4 text-center text-xs text-muted-foreground">
                  More replies on YouTube
                </p>
              ) : null}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
