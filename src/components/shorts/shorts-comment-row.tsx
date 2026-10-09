"use client";

/**
 * P16-SHORTS-COMMENTS — shorts comment row (the depth-aware surface).
 *
 * Read-only reuse of the watch page's verified seams (the comment-like
 * route, the comment-composer posting idiom, the parentId continuation
 * walking) — wrapped in a shorts-sheet-native row. No kebab/edit/delete/
 * report affordances (honestly omitted — those surfaces are owned by the
 * watch page; the shorts sheet is the lightweight mobile-first surface).
 *
 * PER-COMMENT LIKE (the watch `comment-row` idiom): optimistic with honest
 * revert via `POST /api/comments/{id}/like`; `yourLike` starts from the
 * canonical route's honest value (null for anonymous viewers — never
 * fabricated server truth), then session-local on top.
 *
 * REPLY THREADS (the watch `comments-section` idiom): the "N replies"
 * expander fetches `/api/videos/{videoId}/comments?parentId={id}` (the
 * canonical route serves shorts videoIds AS-IS — shorts ARE videos), walks
 * the cursor for "Show more replies", and nests a per-thread reply
 * composer (the watch `CommentComposer` with parentId + parentText +
 * replyParams — the same wire parameters the watch section forwards).
 *
 * GUEST GATE (P15/P13 precedent): `useWebFlixSession()` unauthenticated →
 * `window.location.assign(signInHref("/shorts"))` (never a guest write).
 * Public-mode (operator session off) → the watch row's "Sign in to
 * continue" dialog (honest, links /account).
 *
 * CREATOR AFFORDANCES (P17): when the viewer IS the short's channel
 * creator (the sheet's `viewerIsCreator` — operator mode + the canonical
 * watch detail flag, see shorts-comments-sheet.tsx), each row grows the
 * watch `comment-row` kebab idiom: ⋮ → Heart / Remove heart (any depth)
 * + Pin / Unpin (top-level only, YouTube's constraint) via the SAME
 * canonical routes (`POST /api/comments/{id}/heart|pin` with {videoId,
 * commentText}), optimistic set → server truth → honest revert +
 * toastActionError on failure. Non-creators keep byte-identical rows
 * (no kebab renders; the heartedByCreator/pinned badges stay read-only).
 */
import { useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  Heart,
  MoreVertical,
  Pin,
  PinOff,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { compactCount } from "@/lib/watch/format";
import { post } from "@/lib/watch/client";
import { toastActionError } from "@/lib/watch/connection-client";
import { signInHref } from "@/lib/auth/client";
import type {
  CommentDto,
  CommentVideoSnapshotDto,
  LikeValue,
  ViewerDto,
} from "@/lib/watch/types";
import { CommentComposer } from "@/components/watch/comment-composer";
import { VerifiedBadge } from "@/components/app/verified-badge";

export interface ShortsCommentRowProps {
  comment: CommentDto;
  videoId: string;
  /** WFX2-P6-CR: nullable — anonymous viewers still read the thread */
  viewer: ViewerDto | null;
  /** false in public mode → signed-out states for the write affordances */
  operatorSession: boolean;
  /** WFX2-P2-AU: no WebFlix account → writes route to the sign-in prompt */
  guest: boolean;
  /** WFX2-P6-CR: the watch payload's snapshot (the local rung's shadow rows) */
  video?: CommentVideoSnapshotDto;
  /** P17: the viewer IS this short's channel creator → the watch kebab
   * idiom (heart/pin writes) renders; default false (the honest default —
   * uncertain/degraded detection shows NO affordance) */
  viewerIsCreator?: boolean;
  /** nesting depth (0 = top-level; 1 = rendered reply level) */
  depth?: number;
}

export function ShortsCommentRow({
  comment,
  videoId,
  viewer,
  operatorSession,
  guest,
  video,
  viewerIsCreator = false,
  depth = 0,
}: ShortsCommentRowProps) {
  // ---- like state (session-local on top of the canonical route's honest value)
  const [like, setLike] = useState<{ likes: number; yourLike: LikeValue | null }>({
    likes: comment.likes,
    yourLike: comment.yourLike,
  });
  const [replyOpen, setReplyOpen] = useState(false);
  const [threadOpen, setThreadOpen] = useState(false);
  const [threadReplies, setThreadReplies] = useState<CommentDto[]>(
    comment.replies ?? [],
  );
  const [threadCursor, setThreadCursor] = useState<string | null>(
    comment.replyNextCursor ?? null,
  );
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadLoadingMore, setThreadLoadingMore] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  // ---- creator write state (P17): starts at the canonical truth, then
  // optimistic set → server truth → honest revert (the row's like idiom) ----
  const [hearted, setHearted] = useState(comment.heartedByCreator);
  const [pinned, setPinned] = useState(comment.pinned);

  /** P15/P13: guests go to /signin (redirect back to /shorts); public-mode
   * operator gaps keep the honest "Sign in to continue" dialog. */
  const promptSignIn = () => {
    if (guest) {
      window.location.assign(signInHref("/shorts"));
      return;
    }
    setSignInOpen(true);
  };

  // ---- PER-COMMENT LIKE: the watch `comment-row` idiom (optimistic + revert) ----
  const toggleLike = async (value: LikeValue) => {
    if (guest || !operatorSession) {
      promptSignIn();
      return;
    }
    const prev = { ...like };
    const optimistic = { ...like };
    if (like.yourLike === value) {
      optimistic.yourLike = null;
      if (value === "like") optimistic.likes = like.likes - 1;
    } else {
      optimistic.yourLike = value;
      optimistic.likes = like.likes + (value === "like" ? 1 : -1);
    }
    setLike(optimistic);
    try {
      const result = await post<{ likes: number; yourLike: LikeValue | null }>(
        `/api/comments/${comment.id}/like`,
        {
          value,
          // baseline + locator keep the broker path honest (WFX2-A-W)
          baseline: { likes: like.likes, yourLike: like.yourLike },
          commentText: comment.body,
          videoId,
        },
      );
      setLike(result); // server truth
    } catch (e) {
      setLike(prev);
      toastActionError(e, "Failed to rate comment");
    }
  };

  // ---- CREATOR HEART/PIN (P17): the watch `comment-row` idiom verbatim —
  // the same canonical routes + {videoId, commentText} payload + toasts +
  // guest gate — on the sheet's self-held state (optimistic set → server
  // truth → honest revert + toastActionError, the row's like style) ----
  const doHeart = async () => {
    if (guest) {
      promptSignIn();
      return;
    }
    const prev = hearted;
    setHearted(!prev); // optimistic
    try {
      const r = await post<{ heartedByCreator: boolean }>(
        `/api/comments/${comment.id}/heart`,
        { videoId, commentText: comment.body },
      );
      setHearted(r.heartedByCreator); // server truth
    } catch (e) {
      setHearted(prev); // honest revert
      toastActionError(e, "Failed to heart");
    }
  };

  const doPin = async () => {
    if (guest) {
      promptSignIn();
      return;
    }
    const prev = pinned;
    setPinned(!prev); // optimistic
    try {
      const r = await post<{ pinned: boolean }>(
        `/api/comments/${comment.id}/pin`,
        { videoId, commentText: comment.body },
      );
      setPinned(r.pinned); // server truth
      toast.success(r.pinned ? "Comment pinned" : "Comment unpinned");
    } catch (e) {
      setPinned(prev); // honest revert
      toastActionError(e, "Failed to pin");
    }
  };

  // ---- REPLY THREADS: the watch `comments-section` parentId continuation ----
  const toggleThread = async () => {
    const willOpen = !threadOpen;
    setThreadOpen(willOpen);
    if (
      willOpen &&
      threadReplies.length === 0 &&
      comment.totalReplyCount > 0
    ) {
      setThreadLoading(true);
      try {
        const page = await fetch(
          `/api/videos/${videoId}/comments?parentId=${encodeURIComponent(comment.id)}`,
          { cache: "no-store" },
        ).then((r) => r.json() as Promise<{ items: CommentDto[]; nextCursor: string | null }>);
        setThreadReplies(page.items ?? []);
        setThreadCursor(page.nextCursor ?? null);
      } catch {
        // honest — don't fake replies; the expander stays empty
      } finally {
        setThreadLoading(false);
      }
    }
  };

  const loadMoreReplies = async () => {
    if (!threadCursor || threadLoadingMore) return;
    setThreadLoadingMore(true);
    try {
      const page = await fetch(
        `/api/videos/${videoId}/comments?parentId=${encodeURIComponent(comment.id)}&cursor=${encodeURIComponent(threadCursor)}`,
        { cache: "no-store" },
      ).then((r) => r.json() as Promise<{ items: CommentDto[]; nextCursor: string | null }>);
      setThreadReplies((prev) => [...prev, ...(page.items ?? [])]);
      setThreadCursor(page.nextCursor ?? null);
    } catch {
      // honest — don't fake
    } finally {
      setThreadLoadingMore(false);
    }
  };

  const onAppendReply = (c: CommentDto) => {
    setThreadReplies((prev) => [...prev, c]);
    setThreadOpen(true);
    setReplyOpen(false);
  };

  const avatarSize = depth === 0 ? "size-9" : "size-6 sm:size-7";
  const showThread = depth === 0 && comment.totalReplyCount > 0;
  const showReplyButton = depth === 0;

  return (
    <article
      className={cn(
        "flex gap-3",
        depth === 0 ? "py-3" : "py-2",
      )}
      aria-label={`Comment by ${comment.author.name}`}
    >
      <Avatar className={cn(avatarSize, "shrink-0")}>
        <AvatarImage src={comment.author.avatarUrl} alt="" />
        <AvatarFallback>
          {comment.author.name.slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        {pinned && depth === 0 && (
          <p className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Pin className="size-3" aria-hidden="true" /> Pinned
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span
            className={cn(
              "font-medium text-foreground/90",
              depth === 0 ? "text-[13px]" : "text-xs",
            )}
          >
            {comment.author.name}
          </span>
          {comment.author.isCreator && <VerifiedBadge />}
          {comment.local && (
            <span
              className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              title="Stored on WebFlix — not posted to YouTube"
            >
              WebFlix
            </span>
          )}
          {comment.publishedText && (
            <span className="text-xs text-muted-foreground">
              {comment.publishedText}
              {comment.edited && " (edited)"}
            </span>
          )}
        </div>

        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-snug text-foreground/90">
          {comment.body}
        </p>

        {/* actions: like + dislike + (reply at depth 0) */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => toggleLike("like")}
            aria-pressed={like.yourLike === "like"}
            aria-label={
              like.likes > 0
                ? `Like this comment along with ${compactCount(like.likes)} other people`
                : "Like this comment"
            }
            className="flex min-h-8 items-center gap-1.5 rounded-full px-2 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <ThumbsUp
              className={cn(
                "size-4",
                like.yourLike === "like" && "fill-current text-[#f03]",
              )}
              aria-hidden="true"
            />
            {like.likes > 0 && (
              <span className="tabular-nums">{compactCount(like.likes)}</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => toggleLike("dislike")}
            aria-pressed={like.yourLike === "dislike"}
            aria-label="Dislike this comment"
            className="flex min-h-8 min-w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <ThumbsDown
              className={cn(
                "size-4",
                like.yourLike === "dislike" && "fill-current text-[#f03]",
              )}
              aria-hidden="true"
            />
          </button>

          {hearted && (
            <span
              className="flex items-center rounded-full px-2 py-1"
              title="Loved by creator"
            >
              <Heart
                className="size-4 fill-[#f03] text-[#f03]"
                aria-label="Loved by creator"
              />
            </span>
          )}

          {showReplyButton && (
            <button
              type="button"
              onClick={() => {
                if (guest || !operatorSession) {
                  promptSignIn();
                  return;
                }
                setReplyOpen((o) => !o);
              }}
              className="flex min-h-8 items-center rounded-full px-3 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              Reply
            </button>
          )}

          {/* CREATOR KEBAB (P17): the watch `comment-row` placement (ml-auto,
              ⋮ menu) — rendered ONLY for the short's channel creator, so
              non-creator rows stay byte-identical. Heart at any depth; pin
              top-level only (YouTube's constraint, the watch rule). */}
          {viewerIsCreator && (
            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Comment actions for ${comment.author.name}'s comment`}
                    className="flex min-h-8 min-w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    <MoreVertical className="size-4" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    onClick={doHeart}
                    className="cursor-pointer gap-3 py-2.5 text-sm"
                  >
                    <Heart className="size-4" aria-hidden="true" />
                    {hearted ? "Remove heart" : "Heart"}
                  </DropdownMenuItem>
                  {depth === 0 && (
                    <DropdownMenuItem
                      onClick={doPin}
                      className="cursor-pointer gap-3 py-2.5 text-sm"
                    >
                      {pinned ? (
                        <PinOff className="size-4" aria-hidden="true" />
                      ) : (
                        <Pin className="size-4" aria-hidden="true" />
                      )}
                      {pinned ? "Unpin" : "Pin"}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {/* inline reply composer (depth 0) — the watch `CommentComposer`
            with parentId + parentText + replyParams (the same wire
            parameters the watch section forwards; null when YouTube served
            the sign-in modal — the composer handles the honest degrade). */}
        {replyOpen && showReplyButton && (
          <div className="mt-3">
            <CommentComposer
              videoId={videoId}
              parentId={comment.id}
              parentText={comment.body}
              replyParams={comment.replyParams}
              viewer={viewer}
              operatorSession={operatorSession}
              guest={false}
              video={video}
              placeholder="Add a reply..."
              submitLabel="Reply"
              autoFocus
              compact
              onSubmitted={onAppendReply}
              onCancel={() => setReplyOpen(false)}
            />
          </div>
        )}

        {/* the "N replies" expander (depth 0) — the watch section idiom */}
        {showThread && (
          <div className="mt-2">
            <button
              type="button"
              onClick={toggleThread}
              aria-expanded={threadOpen}
              className="flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-primary/90 transition hover:bg-primary/10"
            >
              {threadOpen ? (
                <>
                  <ChevronUp className="size-4" aria-hidden="true" />
                  Hide replies
                </>
              ) : (
                <>
                  <ChevronDown className="size-4" aria-hidden="true" />
                  {comment.totalReplyCount}{" "}
                  {comment.totalReplyCount === 1 ? "reply" : "replies"}
                </>
              )}
            </button>

            {threadOpen && (
              <div className="mt-2 space-y-2 border-l-2 border-border pl-3">
                {threadLoading ? (
                  <div
                    className="flex items-center gap-2 py-1 text-xs text-muted-foreground"
                    aria-live="polite"
                  >
                    <span className="size-3.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                    Loading replies…
                  </div>
                ) : (
                  threadReplies.map((r) => (
                    <ShortsCommentRow
                      key={r.id}
                      comment={r}
                      videoId={videoId}
                      viewer={viewer}
                      operatorSession={operatorSession}
                      guest={guest}
                      video={video}
                      viewerIsCreator={viewerIsCreator}
                      depth={1}
                    />
                  ))
                )}
                {threadCursor && !threadLoading && (
                  <button
                    type="button"
                    onClick={loadMoreReplies}
                    disabled={threadLoadingMore}
                    className="flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-primary/90 transition hover:bg-primary/10 disabled:opacity-50"
                  >
                    {threadLoadingMore ? "Loading…" : "Show more replies"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* public-mode write gate — YouTube's "Sign in to continue" parity */}
      <Dialog open={signInOpen} onOpenChange={setSignInOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Sign in to continue</DialogTitle>
            <DialogDescription>
              This action acts on the operator&apos;s YouTube session. No session is configured
              right now (public mode).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setSignInOpen(false)}
              className="rounded-full"
            >
              Cancel
            </Button>
            <Button asChild className="rounded-full">
              <a href="/account">Sign in</a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
