"use client";

/**
 * P16-SHORTS-COMMENTS — YouTube-parity shorts comments bottom sheet.
 *
 * Mobile-first bottom sheet (Sheet side="bottom"; on sm+ it caps to a
 * centered max-w column). Wires the watch page's verified comment seams
 * to the shorts surface — shorts ARE videos, the canonical comment routes
 * serve shorts videoIds AS-IS (no API edit, the P15 seam law).
 *
 * COMPOSER (top, sticky under the header): the watch `CommentComposer`
 * posting idiom — `POST /api/comments` (the three-rung chain: direct
 * SAPISIDHASH → broker → the honest LOCAL store, `local:true` disclosure).
 * WebFlix guests get the P15 gate idiom (`signInHref("/shorts")`, never a
 * guest write); public-mode (operator session off) keeps the watch
 * composer's "Comment..." → "Sign in to continue to comment" dialog.
 *
 * PER-COMMENT LIKE: `ShortsCommentRow` (the watch `comment-row` idiom —
 * optimistic with honest revert via `POST /api/comments/{id}/like`;
 * your-state session-local keyed per comment id, never fabricated).
 *
 * REPLY THREADS: `ShortsCommentRow` (the watch `comments-section` parentId
 * continuation walking — no new API; the "N replies" expander + nested
 * rendering + a per-thread reply composer via the watch `CommentComposer`).
 *
 * SORT CONTROL: Top comments / Newest first — the watch `comments-section`
 * changeSort idiom (refetch on change, cursor reset, the `?sort=` seam).
 *
 * CREATOR AFFORDANCES (heart/pin writes): honestly omitted — the
 * creator-context detection (`viewerIsCreator` from the watch session
 * state) requires the watch detail route (`/api/videos/[id]`), a heavier
 * call the shorts sheet doesn't make; shipping the affordances without
 * the detection would either show them to non-creators (wrong) or
 * require a new server call out of scope. The DISPLAY of
 * `heartedByCreator`/`pinned` (read-only badges) stays. See the report.
 *
 * HONEST PAGING: the sheet fetches its own list from the canonical route
 * `/api/videos/{videoId}/comments?sort=` (independent of `meta.comments`);
 * the header count text comes from `meta.commentsCountText` (already
 * hydrated by the feed — no layout shift when meta arrives). Skeletons
 * while the canonical list loads; cursor pagination via "Show more".
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowDownUp } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { api } from "@/lib/watch/client";
import { signInHref } from "@/lib/auth/client";
import type {
  CommentDto,
  CommentVideoSnapshotDto,
  CommentsPageDto,
  ViewerDto,
} from "@/lib/watch/types";
import type { ShortMetaDTO } from "@/lib/youtube/shorts";
import { CommentComposer } from "@/components/watch/comment-composer";
import { ShortsCommentRow } from "./shorts-comment-row";

type SortValue = "top" | "new";

export function ShortsCommentsSheet({
  videoId,
  meta,
  open,
  onClose,
  guest,
}: {
  videoId: string;
  meta: ShortMetaDTO | null;
  open: boolean;
  onClose: () => void;
  /** P15/P13: no WebFlix account session → writes route to the sign-in prompt */
  guest: boolean;
}) {
  // ---- session probe (viewer + operatorSession) — one fetch per open ----
  const [viewer, setViewer] = useState<ViewerDto | null>(null);
  const [operatorSession, setOperatorSession] = useState(true);

  // ---- the canonical comments list (independent of meta.comments) ----
  const [items, setItems] = useState<CommentDto[] | null>(null);
  const [total, setTotal] = useState<number>(0);
  const [sort, setSort] = useState<SortValue>("top");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const load = useCallback(
    async (s: SortValue, c?: string): Promise<CommentsPageDto> => {
      const qs = `sort=${s}${c ? `&cursor=${encodeURIComponent(c)}` : ""}`;
      return api<CommentsPageDto>(`/api/videos/${videoId}/comments?${qs}`);
    },
    [videoId],
  );

  // ---- fresh fetch on open / videoId / sort change ----
  // NOTE: state is set ONLY inside async callbacks (.then/.catch) — never
  // synchronously in the effect body (the react-hooks/set-state-in-effect
  // rule). The reset-to-skeletons on sort change happens in `changeSort`
  // (the click handler, not the effect); on open/videoId change the prior
  // list is briefly visible until the new page resolves (acceptable — the
  // sheet is a transient overlay, not a routed page).
  useEffect(() => {
    if (!open) return;
    let alive = true;

    // session probe (one per open — the watch page's bootstrap idiom)
    void api<{ viewer: ViewerDto; operatorSession?: boolean }>(
      "/api/watch/session",
    )
      .then((r) => {
        if (!alive) return;
        setViewer(r.viewer);
        setOperatorSession(r.operatorSession !== false);
      })
      .catch(() => {
        // honest — leave viewer null + operatorSession true (the default);
        // the composer/row gates own the signed-out states
      });

    load(sort)
      .then((page) => {
        if (!alive) return;
        setItems(page.items);
        setTotal(page.total);
        setCursor(page.nextCursor);
        setListError(null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setItems([]);
        setListError(
          e instanceof Error ? e.message : "Failed to load comments",
        );
      });

    return () => {
      alive = false;
    };
  }, [open, videoId, sort, load]);

  const changeSort = (s: SortValue) => {
    if (s === sort) return;
    // reset to skeletons (in the handler, not the effect — the lint-clean
    // watch `comments-section` idiom) + cursor reset
    setItems(null);
    setListError(null);
    setCursor(null);
    setSort(s);
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

  // ---- the watch payload's video snapshot (the local rung's shadow rows) ----
  const video: CommentVideoSnapshotDto | undefined = meta
    ? {
        ...(meta.title ? { title: meta.title } : {}),
        ...(meta.channel.id ? { channelId: meta.channel.id } : {}),
        ...(meta.channel.handle ? { channelHandle: meta.channel.handle } : {}),
        ...(meta.channel.name ? { channelName: meta.channel.name } : {}),
        ...(meta.channel.avatarUrl
          ? { channelAvatarUrl: meta.channel.avatarUrl }
          : {}),
      }
    : undefined;

  // header count text — prefer meta.commentsCountText (already hydrated by
  // the feed, no layout shift), fall back to the canonical list's total
  const countText =
    meta?.commentsCountText ??
    (total > 0 ? `${total} Comments` : "Comments");

  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <SheetContent
        side="bottom"
        className="flex h-[88dvh] flex-col gap-0 p-0 sm:mx-auto sm:max-w-xl sm:rounded-t-2xl"
      >
        {/* Swipe-down affordance */}
        <div className="flex justify-center pt-2" aria-hidden="true">
          <div className="h-1.5 w-10 rounded-full bg-muted-foreground/40" />
        </div>

        <SheetHeader className="flex-row items-center gap-2 border-b px-4 py-3 pr-12">
          <SheetTitle className="text-base">Comments</SheetTitle>
          <span className="text-sm text-muted-foreground">{countText}</span>
          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Sort comments"
                  aria-haspopup="menu"
                  className="flex h-9 min-h-9 min-w-9 items-center justify-center gap-2 rounded-full px-3 text-sm font-medium transition hover:bg-accent"
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
          </div>
        </SheetHeader>
        <SheetDescription className="sr-only">
          Comments for short {videoId}
        </SheetDescription>

        {/* scroll area: composer (sticky top) + list + show-more */}
        <div className="slim-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* COMPOSER — sticky under the header (youtube.com mobile shorts
              sheet placement). Guest → the P15 gate box; else the watch
              CommentComposer (handles public-mode + signed-in flows). */}
          <div className="sticky top-0 z-10 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/75">
            {guest ? (
              <div className="flex w-full items-center gap-3">
                <Avatar className="size-9">
                  <AvatarFallback aria-hidden="true">
                    <span className="text-xs text-muted-foreground">?</span>
                  </AvatarFallback>
                </Avatar>
                <div className="flex h-10 min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border border-border px-4">
                  <span className="truncate text-sm text-muted-foreground">
                    Sign in to comment
                  </span>
                  <a
                    href={signInHref("/shorts")}
                    className="shrink-0 text-sm font-medium text-yt-red hover:underline"
                  >
                    Sign in
                  </a>
                </div>
              </div>
            ) : (
              <CommentComposer
                videoId={videoId}
                viewer={viewer}
                operatorSession={operatorSession}
                guest={false}
                video={video}
                placeholder="Add a comment..."
                onSubmitted={(c) => {
                  // optimistic: appears instantly; the server row IS the row
                  setItems((prev) => [c, ...(prev ?? [])]);
                  setTotal((n) => n + 1);
                }}
              />
            )}
          </div>

          {/* LIST */}
          <div className="px-4 pb-4">
            {items === null ? (
              <ul role="list" aria-label="Loading comments" aria-busy="true">
                {Array.from({ length: 5 }).map((_, i) => (
                  <CommentSkeletonRow key={i} />
                ))}
              </ul>
            ) : listError ? (
              <div className="py-10 text-center" role="alert">
                <p className="text-sm text-muted-foreground">{listError}</p>
              </div>
            ) : items.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No comments yet. Be the first to say something.
              </p>
            ) : (
              <>
                <ul role="list" aria-label="Comments" className="divide-y divide-border/40">
                  {items.map((comment) => (
                    <li key={comment.id}>
                      <ShortsCommentRow
                        comment={comment}
                        videoId={videoId}
                        viewer={viewer}
                        operatorSession={operatorSession}
                        guest={guest}
                        video={video}
                        depth={0}
                      />
                    </li>
                  ))}
                </ul>
                {cursor && (
                  <button
                    type="button"
                    onClick={showMore}
                    disabled={loadingMore}
                    className="mx-auto mt-4 flex min-h-11 items-center gap-2 rounded-full border border-border px-5 text-sm font-medium transition hover:bg-accent disabled:opacity-50"
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
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
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
