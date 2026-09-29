"use client";

/**
 * WFX2-W comments section — count header + sort control (Top comments by
 * likes / Newest first), composer with optimistic insert, rows, reply
 * threads, "Show more" server cursor pagination (10/page), honest empty
 * state.
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowDownUp, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/watch/client";
import { compactCount } from "@/lib/watch/format";
import type { CommentDto, CommentsPageDto, PageDto, ViewerDto } from "@/lib/watch/types";
import { CommentComposer } from "./comment-composer";
import { CommentRow } from "./comment-row";

interface ThreadState {
  replies: CommentDto[];
  cursor: string | null;
  loading: boolean;
}

export function CommentsSection({
  videoId,
  viewer,
  viewerIsCreator,
  creatorName,
}: {
  videoId: string;
  viewer: ViewerDto;
  viewerIsCreator: boolean;
  creatorName: string;
}) {
  const [items, setItems] = useState<CommentDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<"top" | "new">("top");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [threads, setThreads] = useState<Record<string, ThreadState>>({});

  const load = useCallback(
    async (s: "top" | "new", c?: string) => {
      const page = await api<CommentsPageDto>(
        `/api/videos/${videoId}/comments?sort=${s}${c ? `&cursor=${encodeURIComponent(c)}` : ""}`
      );
      return page;
    },
    [videoId]
  );

  // fresh mount per video (parent keys the page); fetch once, then on sort change
  useEffect(() => {
    let alive = true;
    load(sort)
      .then((page) => {
        if (!alive) return;
        setItems(page.items);
        setTotal(page.total);
        setCursor(page.nextCursor);
      })
      .catch((e) => {
        if (alive) toast.error(e instanceof Error ? e.message : "Failed to load comments");
      });
    return () => {
      alive = false;
    };
  }, [load, sort]);

  const changeSort = (s: "top" | "new") => {
    if (s === sort) return;
    setSort(s);
    setItems(null);
    setThreads({});
    setCursor(null);
  };

  const showMore = async () => {
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
  };

  const toggleThread = (id: string, initial: CommentDto) => {
    setThreads((t) => {
      if (t[id]) {
        const { [id]: _removed, ...rest } = t;
        return rest; // hide
      }
      return {
        ...t,
        [id]: {
          replies: initial.replies ?? [],
          cursor: initial.replyNextCursor ?? null,
          loading: false,
        },
      };
    });
  };

  const loadMoreReplies = async (parentId: string) => {
    const thread = threads[parentId];
    if (!thread || thread.loading) return;
    setThreads((t) => ({ ...t, [parentId]: { ...t[parentId], loading: true } }));
    try {
      const page = await api<PageDto<CommentDto>>(
        `/api/videos/${videoId}/comments?parentId=${parentId}&cursor=${encodeURIComponent(
          thread.cursor ?? ""
        )}`
      );
      setThreads((t) => ({
        ...t,
        [parentId]: { replies: [...t[parentId].replies, ...page.items], cursor: page.nextCursor, loading: false },
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load replies");
      setThreads((t) => ({ ...t, [parentId]: { ...t[parentId], loading: false } }));
    }
  };

  const appendReply = (parentId: string, c: CommentDto) => {
    setThreads((t) => {
      const existing = t[parentId];
      if (existing) {
        return { ...t, [parentId]: { ...existing, replies: [...existing.replies, c] } };
      }
      // thread not open yet — open it with the fresh reply
      return { ...t, [parentId]: { replies: [c], cursor: null, loading: false } };
    });
    setTotal((n) => n + 1);
  };

  const onDeleted = (id: string) => {
    setItems((prev) => prev?.filter((c) => c.id !== id) ?? null);
    setThreads((t) => {
      const next: Record<string, ThreadState> = {};
      for (const [k, v] of Object.entries(t)) {
        next[k] = { ...v, replies: v.replies.filter((r) => r.id !== id) };
      }
      return next;
    });
    setTotal((n) => Math.max(0, n - 1));
  };

  const onReported = (id: string) => {
    onDeleted(id);
  };

  const onChanged = (c: CommentDto) => {
    setItems((prev) => prev?.map((x) => (x.id === c.id ? c : x)) ?? null);
    setThreads((t) => {
      const next: Record<string, ThreadState> = {};
      for (const [k, v] of Object.entries(t)) {
        next[k] = { ...v, replies: v.replies.map((r) => (r.id === c.id ? c : r)) };
      }
      return next;
    });
  };

  return (
    <section aria-label="Comments" className="mt-6">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-bold sm:text-lg">
          <MessageSquare className="size-5 text-muted-foreground" aria-hidden="true" />
          {total === 0 ? "Comments" : `${compactCount(total)} Comments`}
        </h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Sort comments"
              aria-haspopup="menu"
              className="flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium transition hover:bg-accent"
            >
              <ArrowDownUp className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">
                {sort === "top" ? "Top comments" : "Newest first"}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem
              onClick={() => changeSort("top")}
              role="menuitemradio"
              aria-checked={sort === "top"}
              className="cursor-pointer py-2.5 text-sm"
            >
              Top comments
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => changeSort("new")}
              role="menuitemradio"
              aria-checked={sort === "new"}
              className="cursor-pointer py-2.5 text-sm"
            >
              Newest first
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="mb-6">
        <CommentComposer
          videoId={videoId}
          viewer={viewer}
          onSubmitted={(c) => {
            // optimistic: appears instantly; the server row IS the row
            setItems((prev) => [c, ...(prev ?? [])]);
            setTotal((n) => n + 1);
          }}
        />
      </div>

      {items === null ? (
        <div className="space-y-6" aria-busy="true" aria-label="Loading comments">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-3">
              <div className="size-10 animate-pulse rounded-full bg-secondary" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-32 animate-pulse rounded bg-secondary" />
                <div className="h-3 w-full animate-pulse rounded bg-secondary" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-secondary" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-muted-foreground">
            No comments yet. Be the first to say something.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {items.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              videoId={videoId}
              viewer={viewer}
              viewerIsCreator={viewerIsCreator}
              creatorName={creatorName}
              depth={0}
              threadReplies={threads[c.id]?.replies}
              threadCursor={threads[c.id]?.cursor}
              loadingReplies={threads[c.id]?.loading}
              onToggleThread={() => toggleThread(c.id, c)}
              onAppendReply={(reply) => appendReply(c.id, reply)}
              onLoadMoreReplies={() => loadMoreReplies(c.id)}
              onDeleted={onDeleted}
              onReported={onReported}
              onChanged={onChanged}
            />
          ))}

          {cursor && (
            <button
              type="button"
              onClick={showMore}
              disabled={loadingMore}
              className="flex h-10 items-center gap-2 rounded-full border border-border px-5 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
            >
              {loadingMore ? (
                <>
                  <span className="size-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                  Loading…
                </>
              ) : (
                "Show more comments"
              )}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
