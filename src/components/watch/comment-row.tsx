"use client";

/**
 * WFX2 comment row — author + age, pinned label, member/creator badges,
 * body with …more expansion, like/dislike with count + your-state, creator
 * heart badge, inline reply thread, kebab (Edit/Delete/Report + creator
 * Heart/Pin), inline edit mode.
 *
 * WFX2-B-S: the writes are YouTube-parity — delete goes through the
 * confirm dialog (⋮ → Delete → "Delete comment?" → Delete), edit posts the
 * locator (videoId + current text) with the new body, report opens the
 * comment-report dialog (reasons list), and in public mode (no operator
 * session) the write affordances render their signed-out states — the
 * "Sign in to continue" dialog, never fake writes.
 *
 * WFX2-P2-AU: WebFlix guests (no account session) get the sign-in prompt
 * (routed to /signin with the redirect back) instead of any write firing.
 */
import { useState } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  Flag,
  Heart,
  MoreVertical,
  Pencil,
  Pin,
  PinOff,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { compactCount, relativeTime } from "@/lib/watch/format";
import { post, patch, del } from "@/lib/watch/client";
import { signInHref } from "@/lib/auth/client";
import type { CommentDto, LikeValue, ViewerDto } from "@/lib/watch/types";
import { CommentComposer } from "./comment-composer";
import { CommentReportDialog } from "./comment-report-dialog";

export interface CommentRowProps {
  comment: CommentDto;
  videoId: string;
  viewer: ViewerDto;
  viewerIsCreator: boolean;
  creatorName: string;
  /** false in public mode → signed-out states for the write affordances */
  operatorSession?: boolean;
  /** WFX2-P2-AU: no WebFlix account → writes route to the sign-in prompt */
  guest?: boolean;
  /** nesting depth (0 = top-level; 1 = rendered reply level; 2+ inline) */
  depth: number;
  /** open reply thread state (for depth 0) */
  threadReplies?: CommentDto[];
  threadCursor?: string | null;
  onToggleThread?: () => void;
  onAppendReply?: (c: CommentDto) => void;
  onLoadMoreReplies?: () => void;
  loadingReplies?: boolean;
  onDeleted: (id: string) => void;
  onReported: (id: string) => void;
  onChanged: (c: CommentDto) => void;
  onReply?: (id: string) => void;
}

export function CommentRow({
  comment,
  videoId,
  viewer,
  viewerIsCreator,
  creatorName,
  operatorSession = true,
  guest = false,
  depth,
  threadReplies,
  threadCursor,
  onToggleThread,
  onAppendReply,
  onLoadMoreReplies,
  loadingReplies,
  onDeleted,
  onReported,
  onChanged,
  onReply,
}: CommentRowProps) {
  const [like, setLike] = useState<{ likes: number; yourLike: LikeValue | null }>({
    likes: comment.likes,
    yourLike: comment.yourLike,
  });
  const [expandedBody, setExpandedBody] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [replyOpen, setReplyOpen] = useState(false);
  const [nestedOpen, setNestedOpen] = useState(false);
  const [nestedReplies, setNestedReplies] = useState<CommentDto[]>([]);
  const [nestedLoading, setNestedLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);

  /** WFX2-P2-AU: the account gate — guests go to /signin (redirect back);
   * public-mode operator gaps keep the honest "Sign in to continue" dialog. */
  const promptSignIn = () => {
    if (guest) {
      window.location.assign(signInHref(`/watch/${videoId}`));
      return;
    }
    setSignInOpen(true);
  };

  const toggleLike = async (value: LikeValue) => {
    if (guest || !operatorSession) {
      promptSignIn(); // YouTube parity: signed-out → sign-in prompt
      return;
    }
    // optimistic
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
        }
      );
      setLike(result); // server truth
    } catch (e) {
      setLike(prev);
      toast.error(e instanceof Error ? e.message : "Failed to rate comment");
    }
  };

  const saveEdit = async () => {
    const trimmed = editBody.trim();
    if (!trimmed) return;
    try {
      const result = await patch<{ ok: boolean; body: string; edited: boolean }>(
        `/api/comments/${comment.id}`,
        {
          body: trimmed,
          videoId,
          commentText: comment.body, // the broker's DOM locator (current text)
        }
      );
      onChanged({
        ...comment,
        body: result.body,
        edited: result.edited,
        publishedText: comment.publishedText
          ? `${comment.publishedText} (edited)`
          : comment.publishedText,
      });
      setEditing(false);
      toast.success("Comment updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to edit comment");
    }
  };

  const doDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await del(`/api/comments/${comment.id}`, {
        videoId,
        commentText: comment.body,
      });
      onDeleted(comment.id);
      setConfirmDelete(false);
      toast("Comment deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete comment");
    } finally {
      setDeleting(false);
    }
  };

  const doHeart = async () => {
    if (guest) {
      promptSignIn();
      return;
    }
    try {
      const r = await post<{ heartedByCreator: boolean }>(`/api/comments/${comment.id}/heart`, {
        videoId,
        commentText: comment.body,
      });
      onChanged({ ...comment, heartedByCreator: r.heartedByCreator, likes: like.likes });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to heart");
    }
  };

  const doPin = async () => {
    if (guest) {
      promptSignIn();
      return;
    }
    try {
      const r = await post<{ pinned: boolean }>(`/api/comments/${comment.id}/pin`, {
        videoId,
        commentText: comment.body,
      });
      onChanged({ ...comment, pinned: r.pinned });
      toast.success(r.pinned ? "Comment pinned" : "Comment unpinned");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to pin");
    }
  };

  const loadNested = async () => {
    const willOpen = !nestedOpen;
    setNestedOpen(willOpen);
    if (willOpen && nestedReplies.length === 0 && comment.replyCount > 0) {
      setNestedLoading(true);
      try {
        const page = await get0<{ items: CommentDto[]; nextCursor: string | null }>(
          `/api/videos/${videoId}/comments?parentId=${comment.id}`
        );
        setNestedReplies(page.items);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load replies");
      } finally {
        setNestedLoading(false);
      }
    }
  };

  const isLong = comment.body.length > 280 || comment.body.split("\n").length > 4;
  const avatarSize = depth === 0 ? "size-9 sm:size-10" : depth === 1 ? "size-6 sm:size-7" : "size-6";

  return (
    <article
      className={cn("flex gap-3", depth === 0 ? "" : depth === 1 ? "sm:pl-1" : "sm:pl-2")}
      aria-label={`Comment by ${comment.author.name}`}
    >
      <Avatar className={cn(avatarSize, "shrink-0")}>
        <AvatarImage src={comment.author.avatarUrl} alt="" />
        <AvatarFallback>{comment.author.name.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        {comment.pinned && depth === 0 && (
          <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Pin className="size-3.5" aria-hidden="true" />
            Pinned by {creatorName}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link
            href={`/channel/${comment.author.handle}`}
            className={cn(
              "text-xs font-medium text-foreground hover:underline",
              depth === 0 && "text-[13px]"
            )}
          >
            @{comment.author.handle}
          </Link>
          {comment.author.isCreator && (
            <span className="flex items-center gap-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium">
              <BadgeCheck className="size-3" aria-hidden="true" />
              Creator
            </span>
          )}
          {comment.author.isMember && !comment.author.isCreator && (
            <span
              className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
              title="Channel member"
            >
              <Heart className="size-3 fill-current" aria-hidden="true" />
              Member
            </span>
          )}
          <time className="text-xs text-muted-foreground" dateTime={comment.createdAt ?? undefined}>
            {comment.publishedText ?? relativeTime(comment.createdAt)}
            {comment.edited && <span className="ml-1">(edited)</span>}
          </time>
        </div>

        {editing ? (
          <div className="mt-1.5">
            <div className="flex items-center border-b border-border pb-1.5 focus-within:border-foreground">
              <textarea
                value={editBody}
                autoFocus
                onChange={(e) => setEditBody(e.target.value)}
                rows={2}
                aria-label="Edit comment"
                className="w-full resize-none bg-transparent text-sm outline-none"
                maxLength={10000}
              />
            </div>
            <div className="mt-2 flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 rounded-full"
                onClick={() => {
                  setEditing(false);
                  setEditBody(comment.body);
                }}
              >
                Cancel
              </Button>
              <Button size="sm" className="h-8 rounded-full" disabled={!editBody.trim()} onClick={saveEdit}>
                Save
              </Button>
            </div>
          </div>
        ) : (
          <p
            className={cn(
              "mt-1 whitespace-pre-line text-sm leading-relaxed text-foreground/90",
              isLong && !expandedBody && "line-clamp-4"
            )}
          >
            {comment.body}
          </p>
        )}

        {isLong && !editing && (
          <button
            type="button"
            onClick={() => setExpandedBody((x) => !x)}
            className="mt-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={expandedBody}
          >
            {expandedBody ? "Show less" : "Read more"}
          </button>
        )}

        {/* actions */}
        <div className="mt-1 flex items-center gap-1">
          <button
            type="button"
            onClick={() => toggleLike("like")}
            aria-pressed={like.yourLike === "like"}
            aria-label={`Like this comment along with ${compactCount(like.likes)} other people`}
            className="flex h-8 items-center gap-1.5 rounded-full px-2 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <ThumbsUp
              className={cn("size-4", like.yourLike === "like" && "fill-current text-[#f03]")}
              aria-hidden="true"
            />
            <span className="tabular-nums">{compactCount(like.likes)}</span>
          </button>
          <button
            type="button"
            onClick={() => toggleLike("dislike")}
            aria-pressed={like.yourLike === "dislike"}
            aria-label="Dislike this comment"
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <ThumbsDown
              className={cn("size-4", like.yourLike === "dislike" && "fill-current text-[#f03]")}
              aria-hidden="true"
            />
          </button>

          {comment.heartedByCreator && (
            <span
              className="flex items-center rounded-full px-2 py-1"
              title={`Hearted by ${creatorName}`}
            >
              <Heart
                className="size-4 fill-[#f03] text-[#f03]"
                aria-label={`Hearted by ${creatorName}`}
              />
            </span>
          )}

          {depth <= 1 && (
            <button
              type="button"
              onClick={() => {
                setReplyOpen((o) => !o);
                onReply?.(comment.id);
              }}
              className="flex h-8 items-center rounded-full px-3 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              Reply
            </button>
          )}

          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Comment actions for ${comment.author.name}'s comment`}
                  className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  <MoreVertical className="size-4" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {comment.isOwn && operatorSession && !guest && (
                  <DropdownMenuItem
                    onClick={() => setEditing(true)}
                    className="cursor-pointer gap-3 py-2.5 text-sm"
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                    Edit
                  </DropdownMenuItem>
                )}
                {viewerIsCreator && (
                  <>
                    <DropdownMenuItem
                      onClick={doHeart}
                      className="cursor-pointer gap-3 py-2.5 text-sm"
                    >
                      <Heart className="size-4" aria-hidden="true" />
                      {comment.heartedByCreator ? "Remove heart" : "Heart"}
                    </DropdownMenuItem>
                    {depth === 0 && (
                      <DropdownMenuItem
                        onClick={doPin}
                        className="cursor-pointer gap-3 py-2.5 text-sm"
                      >
                        {comment.pinned ? (
                          <PinOff className="size-4" aria-hidden="true" />
                        ) : (
                          <Pin className="size-4" aria-hidden="true" />
                        )}
                        {comment.pinned ? "Unpin" : "Pin"}
                      </DropdownMenuItem>
                    )}
                  </>
                )}
                {!comment.isOwn && (
                  <DropdownMenuItem
                    onClick={() => (!operatorSession || guest ? promptSignIn() : setReportOpen(true))}
                    className="cursor-pointer gap-3 py-2.5 text-sm"
                  >
                    <Flag className="size-4" aria-hidden="true" />
                    Report
                  </DropdownMenuItem>
                )}
                {comment.isOwn && operatorSession && !guest && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setConfirmDelete(true)}
                      className="cursor-pointer gap-3 py-2.5 text-sm text-destructive focus:text-destructive"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* inline reply composer */}
        {replyOpen && (
          <div className="mt-3">
            <CommentComposer
              videoId={videoId}
              parentId={comment.id}
              parentText={comment.body}
              viewer={viewer}
              operatorSession={operatorSession}
              guest={guest}
              placeholder="Add a reply..."
              submitLabel="Reply"
              autoFocus
              compact
              onSubmitted={(c) => {
                setReplyOpen(false);
                onAppendReply?.(c);
              }}
              onCancel={() => setReplyOpen(false)}
            />
          </div>
        )}

        {/* replies under this comment */}
        {depth === 0 && comment.totalReplyCount > 0 && onToggleThread && (
          <div className="mt-2">
            <button
              type="button"
              onClick={onToggleThread}
              aria-expanded={threadReplies !== undefined}
              className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-primary/90 transition hover:bg-primary/10"
            >
              {threadReplies === undefined ? (
                <>
                  <ChevronDown className="size-4" aria-hidden="true" />
                  {comment.totalReplyCount}{" "}
                  {comment.totalReplyCount === 1 ? "reply" : "replies"}
                </>
              ) : (
                <>
                  <ChevronUp className="size-4" aria-hidden="true" />
                  Hide replies
                </>
              )}
            </button>

            {threadReplies !== undefined && (
              <div className="mt-2 space-y-4">
                {threadReplies.map((r) => (
                  <CommentRow
                    key={r.id}
                    comment={r}
                    videoId={videoId}
                    viewer={viewer}
                    viewerIsCreator={viewerIsCreator}
                    creatorName={creatorName}
                    operatorSession={operatorSession}
                    depth={1}
                    onDeleted={onDeleted}
                    onReported={onReported}
                    onChanged={onChanged}
                  />
                ))}
                {loadingReplies && (
                  <div
                    className="flex items-center gap-2 py-1 text-xs text-muted-foreground"
                    aria-live="polite"
                  >
                    <span className="size-3.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                    Loading replies…
                  </div>
                )}
                {threadCursor && !loadingReplies && (
                  <button
                    type="button"
                    onClick={onLoadMoreReplies}
                    className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-primary/90 transition hover:bg-primary/10"
                  >
                    <ChevronDown className="size-4" aria-hidden="true" />
                    Show more replies
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* deeper levels (level-2 replies that have children) collapse to expander */}
        {depth >= 1 && comment.replyCount > 0 && (
          <div className="mt-1.5">
            <button
              type="button"
              onClick={loadNested}
              aria-expanded={nestedOpen}
              className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-primary/90 transition hover:bg-primary/10"
            >
              <ChevronDown
                className={cn("size-3.5 transition-transform", nestedOpen && "rotate-180")}
                aria-hidden="true"
              />
              {comment.replyCount} {comment.replyCount === 1 ? "reply" : "replies"}
            </button>
            {nestedOpen && (
              <div className="mt-2 space-y-3 pl-2">
                {nestedLoading ? (
                  <div
                    className="flex items-center gap-2 py-1 text-xs text-muted-foreground"
                    aria-live="polite"
                  >
                    <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
                    Loading…
                  </div>
                ) : (
                  nestedReplies.map((r) => (
                    <CommentRow
                      key={r.id}
                      comment={r}
                      videoId={videoId}
                      viewer={viewer}
                      viewerIsCreator={viewerIsCreator}
                      creatorName={creatorName}
                      operatorSession={operatorSession}
                      depth={depth + 1}
                      onDeleted={onDeleted}
                      onReported={onReported}
                      onChanged={onChanged}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* delete confirm — YouTube's ⋮ → Delete dialog parity */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete comment?</DialogTitle>
            <DialogDescription>Deleted comments can&apos;t be recovered.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-full"
              disabled={deleting}
              onClick={doDelete}
            >
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* report dialog — YouTube's ⋮ → Report flow parity */}
      <CommentReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        commentId={comment.id}
        videoId={videoId}
        commentText={comment.body}
        onReported={() => onReported(comment.id)}
      />

      {/* signed-out write gate — YouTube's "Sign in to continue" parity */}
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
            <Button variant="ghost" onClick={() => setSignInOpen(false)} className="rounded-full">
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

/** GET helper with query string. */
async function get0<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}
