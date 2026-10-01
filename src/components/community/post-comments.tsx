"use client";

/**
 * WFX2-P2-SO — the expandable per-post comments (paged, sorted): count-aware
 * expander, Top/Newest sort control, composer with optimistic insert (broker
 * post-comment-create), rows with likes (broker post-comment-like), "Show
 * more" server-cursor pagination, and the honest walled degrade (never a
 * fake zero-comment post).
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowDownUp, MessageCircle, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { api } from "@/lib/watch/client";
import { compactCount } from "@/lib/watch/format";
import type { CommentDto } from "@/lib/watch/types";

interface PostCommentsPage {
  items: CommentDto[];
  nextCursor: string | null;
  total?: number;
  walled?: boolean;
}

const MAX_POST_COMMENT_LENGTH = 10_000;

export function PostComments({
  postId,
  onCountLoaded,
}: {
  postId: string;
  /** the parent card's comment-count display (posts the real total) */
  onCountLoaded?: (total: number) => void;
}) {
  const [items, setItems] = useState<CommentDto[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [walled, setWalled] = useState(false);
  const [sort, setSort] = useState<"top" | "new">("top");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [likeBusy, setLikeBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(
    async (s: "top" | "new", c?: string) => {
      const page = await api<PostCommentsPage>(
        `/api/posts/${encodeURIComponent(postId)}/comments?sort=${s}${c ? `&cursor=${encodeURIComponent(c)}` : ""}`
      );
      return page;
    },
    [postId]
  );

  useEffect(() => {
    let alive = true;
    load(sort)
      .then((page) => {
        if (!alive) return;
        setItems(page.items);
        setTotal(typeof page.total === "number" ? page.total : null);
        setWalled(page.walled === true);
        setCursor(page.nextCursor);
        if (typeof page.total === "number") onCountLoaded?.(page.total);
      })
      .catch((e) => {
        if (alive) toast.error(e instanceof Error ? e.message : "Failed to load comments");
      });
    return () => {
      alive = false;
    };
  }, [load, sort, onCountLoaded]);

  async function showMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await load(sort, cursor);
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load more comments");
    } finally {
      setLoadingMore(false);
    }
  }

  function changeSort(s: "top" | "new") {
    if (s === sort) return;
    setSort(s);
    setItems(null);
    setCursor(null);
  }

  async function submit() {
    const text = draft.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      const created = await api<CommentDto>(`/api/posts/${encodeURIComponent(postId)}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: text }),
      });
      setItems((prev) => [created, ...(prev ?? [])]);
      setTotal((t) => (t === null ? null : t + 1));
      setDraft("");
      toast.success("Comment posted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to post the comment");
    } finally {
      setSubmitting(false);
    }
  }

  async function likeComment(comment: CommentDto) {
    if (liked[comment.id] || likeBusy[comment.id]) return;
    setLikeBusy((b) => ({ ...b, [comment.id]: true }));
    try {
      const res = await api<{ likes: number; yourLike: string | null }>(
        `/api/posts/${encodeURIComponent(postId)}/comments/${encodeURIComponent(comment.id)}/like`,
        { method: "POST", body: JSON.stringify({ value: "like", commentText: comment.body.slice(0, 60) }) }
      );
      setLiked((l) => ({ ...l, [comment.id]: res.yourLike === "like" }));
      setItems((prev) =>
        (prev ?? []).map((c) => (c.id === comment.id ? { ...c, likes: res.likes } : c))
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not like the comment");
    } finally {
      setLikeBusy((b) => ({ ...b, [comment.id]: false }));
    }
  }

  if (walled) {
    return (
      <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground" role="status">
        Comments are unavailable from this egress right now — nothing is fabricated.
      </p>
    );
  }

  return (
    <div className="mt-3 border-t border-border pt-3" aria-label="Post comments">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">
          {total !== null ? `${compactCount(total)} comments` : "Comments"}
        </p>
        <div className="flex items-center gap-1">
          <ArrowDownUp className="size-3.5 text-muted-foreground" aria-hidden="true" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
                aria-label="Sort comments"
              >
                {sort === "top" ? "Top comments" : "Newest first"}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => changeSort("top")}>Top comments</DropdownMenuItem>
              <DropdownMenuItem onClick={() => changeSort("new")}>Newest first</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_POST_COMMENT_LENGTH))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Add a comment…"
          aria-label="Add a comment to this post"
          className="h-9 rounded-full"
          maxLength={MAX_POST_COMMENT_LENGTH}
        />
        <Button
          size="sm"
          rounded-full=""
          onClick={() => void submit()}
          disabled={!draft.trim() || submitting}
          className="h-9 shrink-0 rounded-full"
        >
          {submitting ? "Posting…" : "Comment"}
        </Button>
      </div>
      {draft.length > 0 && (
        <p className="mt-1 text-right text-[11px] text-muted-foreground">
          {draft.length}/{MAX_POST_COMMENT_LENGTH}
        </p>
      )}

      {items === null && (
        <div className="mt-3 space-y-3" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="flex gap-2">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3.5 w-full" />
              </div>
            </div>
          ))}
        </div>
      )}

      {items !== null && items.length === 0 && (
        <p className="mt-3 text-xs text-muted-foreground">No comments yet.</p>
      )}

      {items !== null && items.length > 0 && (
        <ul className="mt-3 space-y-3">
          {items.map((comment) => (
            <li key={comment.id} className="flex gap-2">
              {comment.author.avatarUrl ? (
                <img
                  src={comment.author.avatarUrl}
                  alt={`${comment.author.name} avatar`}
                  className="size-8 shrink-0 rounded-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
                  {comment.author.name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{comment.author.name}</span>
                  {comment.publishedText ? ` · ${comment.publishedText}` : ""}
                </p>
                <p className="mt-0.5 break-words text-sm leading-relaxed">{comment.body}</p>
                <div className="mt-1 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void likeComment(comment)}
                    disabled={likeBusy[comment.id]}
                    aria-pressed={liked[comment.id] === true}
                    aria-label={liked[comment.id] ? "Remove comment like" : "Like comment"}
                    className={cn(
                      "flex items-center gap-1 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                      liked[comment.id] && "text-primary"
                    )}
                  >
                    <ThumbsUp className="size-3.5" aria-hidden="true" />
                    {comment.likes > 0 && (
                      <span className="text-xs tabular-nums">{compactCount(comment.likes)}</span>
                    )}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void showMore()}
          disabled={loadingMore}
          className="mt-2 rounded-full"
        >
          {loadingMore ? "Loading…" : "Show more comments"}
        </Button>
      )}
    </div>
  );
}
