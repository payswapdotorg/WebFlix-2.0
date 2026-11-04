"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Ban,
  BookmarkPlus,
  EyeOff,
  Flag,
  Globe2,
  MoreVertical,
  Trash2,
  ExternalLink,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signInHref } from "@/lib/auth/client";
import { useApi } from "@/hooks/use-api";
import { useWebFlixSession } from "@/hooks/use-webflix-session";
import { ShortsFeedShell, ShortsSlideChevrons } from "@/components/shorts/shorts-feed-shell";
import { ShortsSourceSelector } from "@/components/shorts/shorts-source-selector";
import { TikTokImportDialog } from "@/components/shorts/tiktok/tiktok-import-dialog";
import { TikTokFeedPlayer } from "@/components/tiktok/tiktok-feed-player";
import { ShortsMuteButton } from "@/components/shorts/shorts-mute";
import { SHORTS_SOURCE_CAPABILITIES } from "@/lib/shorts/feed-contracts";
import type { TikTokFeedPageDTO } from "@/lib/tiktok/library";
import type { TikTokImportVisibility, TikTokVideoDTO } from "@/lib/tiktok/types";

/**
 * ADR 0013 / WFX2-TIKTOK-SHORTS-EXPERIENCE-1 — the TikTok adapter of the
 * one Shorts experience: a real vertical feed of TikTok posts played
 * through the OFFICIAL Embed Player under the shared shell's active-slide
 * lifecycle (exactly one iframe exists per feed — the active slide's).
 *
 * Data law: cursor pages from /api/tiktok/feed (the `{ items, nextCursor }`
 * shape law), deduped by post id, capped at MAX_ITEMS; a `post` deep link
 * splices the requested post FIRST on page 1. M2: the server composes
 * curated + PUBLIC imports + the viewer's own private saves, and stamps
 * viewer-scoped fields (`visibility`/`owned`); a fresh client-side import
 * splices FIRST so the importer sees it immediately.
 *
 * Action law (the work order's contract §7/§8 + ADR 0013 §5): the rail
 * renders ONLY what the capability map AND this rung's implementation both
 * allow — TikTok has NO official like/comment/follow write API, so the
 * rail ships the honest affordances only: Share (copies the canonical
 * TikTok URL) and Open on TikTok. M2 adds the WebFlix-local import +
 * OWNER manage affordances (visibility flip / remove — WebFlix shelf
 * membership, never a TikTok write); visibility chips are factual
 * ("Only you" / "Imported").
 *
 * M3 (source capabilities, the work order's M3 rung): the ⋯ More menu
 * ships the remaining capability-map affordances, each WebFlix-local and
 * honest — Save to my shelf (the M2 import lane reused per-item; a
 * curated or already-imported post answers the honest no-op), Not
 * interested (a SESSION-LOCAL hide — the slide leaves this viewing only;
 * no persistence is claimed), and Report on TikTok (the outbound posture:
 * TikTok owns moderation of its content, WebFlix claims no moderation
 * lane it does not have — the map's canReport is true for TikTok through
 * this honest outbound form).
 *
 * Attribution law (contract §6): creator/caption/music render ONLY when the
 * metadata lane verified them — missing fields stay missing, never
 * fabricated. The "TikTok" source label is always truthful (it names the
 * source, not a metric).
 */

const MAX_ITEMS = 60;

const CAPS = SHORTS_SOURCE_CAPABILITIES.tiktok;

/** The M3 viewer-stamp overlay shape (the unified flip/save re-render law). */
type TikTokViewerStampOverlay = Partial<Pick<TikTokVideoDTO, "owned" | "visibility">>;

async function shareTikTokPost(item: TikTokVideoDTO) {
  const link = item.deepLinkUrl;
  try {
    await navigator.clipboard.writeText(link);
    toast.success("TikTok link copied");
  } catch {
    toast.info(`Copy manually: ${link}`);
  }
}

/**
 * M3 Save to my shelf — the per-item form of the M2 import: POST the
 * canonical URL to /api/tiktok/import. Outcomes are the import route's own
 * honest answers: a fresh row (private save), the curated no-op, or the
 * idempotent repeat. NEVER claims a TikTok write.
 */
async function saveToMyShelf(item: TikTokVideoDTO): Promise<
  | { kind: "created" }
  | { kind: "curated" }
  | { kind: "already" }
  | { kind: "auth" }
  | { kind: "error"; message?: string }
> {
  try {
    const res = await fetch("/api/tiktok/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: item.deepLinkUrl }),
    });
    if (res.status === 401) return { kind: "auth" };
    const body = (await res.json().catch(() => ({}))) as {
      post?: TikTokVideoDTO;
      alreadyImported?: boolean;
      curated?: boolean;
      error?: string;
    };
    if (!res.ok || !body.post) return { kind: "error", message: body.error };
    if (body.curated) return { kind: "curated" };
    if (body.alreadyImported) return { kind: "already" };
    return { kind: "created" };
  } catch {
    return { kind: "error" };
  }
}

/** The source-specific action rail (mirrors the YouTube rail's geometry). */
function TikTokFeedRail({
  item,
  authenticated,
  onVisibilityFlipped,
  onRemoved,
  onHidden,
  onSaved,
}: {
  item: TikTokVideoDTO;
  authenticated: boolean | null;
  onVisibilityFlipped: (postId: string, visibility: TikTokImportVisibility) => void;
  onRemoved: (postId: string) => void;
  onHidden: (postId: string) => void;
  onSaved: (postId: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    if (authenticated === false) {
      // The AU gate: guests route to /signin and come straight back
      // (the import dialog's own gate law).
      window.location.assign(signInHref(`/shorts?source=tiktok&post=${encodeURIComponent(item.postId)}`));
      return;
    }
    if (authenticated === null) return; // the session is still resolving
    setBusy(true);
    try {
      const result = await saveToMyShelf(item);
      if (result.kind === "created") {
        onSaved(item.postId);
        toast.success("Saved to your TikTok shelf — only you");
      } else if (result.kind === "curated") {
        toast.info("Already in every viewer's TikTok feed");
      } else if (result.kind === "already") {
        toast.info("Already in the WebFlix TikTok shelf");
      } else if (result.kind === "auth") {
        window.location.assign(signInHref(`/shorts?source=tiktok&post=${encodeURIComponent(item.postId)}`));
      } else {
        toast.error(result.message ?? "Could not save the TikTok post");
      }
    } finally {
      setBusy(false);
    }
  }

  async function flip(next: TikTokImportVisibility) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tiktok/import/${encodeURIComponent(item.postId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: next }),
      });
      if (res.ok) {
        onVisibilityFlipped(item.postId, next);
        toast.success(
          next === "public"
            ? "Now visible to every viewer's TikTok feed"
            : "Back to your private saves",
        );
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Could not update the TikTok import");
      }
    } catch {
      toast.error("Could not update the TikTok import");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tiktok/import/${encodeURIComponent(item.postId)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onRemoved(item.postId);
        toast.success("Removed from the TikTok shelf");
      } else {
        toast.error("Could not remove the TikTok import");
      }
    } catch {
      toast.error("Could not remove the TikTok import");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="absolute bottom-16 right-3 z-20 flex flex-col items-center gap-2"
      data-testid="tiktok-shorts-rail"
    >
      {/* P90 — the mute toggle: the shared shorts preference; the feed
          player translates the flip through the documented force_muted
          re-mount (the Embed Player documents no mute command). */}
      <ShortsMuteButton />
      {CAPS.canShare ? (
        <button
          type="button"
          onClick={() => void shareTikTokPost(item)}
          aria-label="Share — copy the TikTok link"
          data-testid="tiktok-shorts-share"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-black/30 p-3 text-white backdrop-blur transition-transform duration-150 hover:scale-105 focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <Share2 className="size-full" aria-hidden="true" />
        </button>
      ) : null}
      {CAPS.canOpenOutbound ? (
        <a
          href={item.deepLinkUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open on TikTok"
          data-testid="tiktok-shorts-outbound"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-black/30 p-3 text-white backdrop-blur transition-transform duration-150 hover:scale-105 focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <ExternalLink className="size-full" aria-hidden="true" />
        </a>
      ) : null}
      {item.owned ? (
        <>
          <button
            type="button"
            onClick={() => void flip(item.visibility === "public" ? "private" : "public")}
            disabled={busy}
            aria-label={item.visibility === "public" ? "Make private — only you" : "Make public — every viewer"}
            data-testid="tiktok-shorts-flip"
            title={item.visibility === "public" ? "Make private — only you" : "Make public — every viewer"}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-black/30 p-3 text-white backdrop-blur transition-transform duration-150 hover:scale-105 focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50"
          >
            {item.visibility === "public" ? (
              <EyeOff className="size-full" aria-hidden="true" />
            ) : (
              <Globe2 className="size-full" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            aria-label="Remove from the TikTok shelf"
            data-testid="tiktok-shorts-remove"
            title="Remove from the TikTok shelf"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-black/30 p-3 text-white backdrop-blur transition-transform duration-150 hover:scale-105 focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-50"
          >
            <Trash2 className="size-full" aria-hidden="true" />
          </button>
        </>
      ) : null}
      {/* M3 — the ⋯ More menu (the YouTube rail's own slot): the remaining
          capability-map affordances, each WebFlix-local and honest. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More actions"
            aria-haspopup="menu"
            data-testid="tiktok-shorts-more"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-black/30 p-3 text-white backdrop-blur transition-transform duration-150 hover:scale-105 focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 motion-reduce:transition-none motion-reduce:hover:scale-100"
          >
            <MoreVertical className="size-full" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="w-56">
          {CAPS.canImport ? (
            <DropdownMenuItem
              disabled={busy || !!item.owned}
              onClick={() => void save()}
              className="cursor-pointer gap-3 py-3 text-sm"
              data-testid="tiktok-shorts-save"
            >
              <BookmarkPlus className="size-4" aria-hidden="true" />
              {item.owned ? "Saved to your shelf" : "Save to my shelf"}
            </DropdownMenuItem>
          ) : null}
          {CAPS.canHide ? (
            <DropdownMenuItem
              onClick={() => {
                // The WebFlix-local hide: a SESSION-LOCAL signal — the
                // slide leaves this viewing only; no persistence claim.
                onHidden(item.postId);
                toast.success("Hidden for this session");
              }}
              className="cursor-pointer gap-3 py-3 text-sm"
              data-testid="tiktok-shorts-hide"
            >
              <Ban className="size-4" aria-hidden="true" />
              Not interested
            </DropdownMenuItem>
          ) : null}
          {CAPS.canReport ? (
            <DropdownMenuItem
              onClick={() => {
                // The honest outbound report posture: TikTok owns
                // moderation of its content; WebFlix claims no moderation
                // lane it does not have (ADR 0004).
                window.open(item.deepLinkUrl, "_blank", "noopener,noreferrer");
              }}
              className="cursor-pointer gap-3 py-3 text-sm"
              data-testid="tiktok-shorts-report"
            >
              <Flag className="size-4" aria-hidden="true" />
              Report on TikTok
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => void shareTikTokPost(item)}
            className="cursor-pointer gap-3 py-3 text-sm"
            data-testid="tiktok-shorts-copy-link"
          >
            <Share2 className="size-4" aria-hidden="true" />
            Copy TikTok link
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function TikTokShortsFeed({ post }: { post?: string | null }) {
  const wfSession = useWebFlixSession();
  const authenticated =
    wfSession.status === "authenticated"
      ? true
      : wfSession.status === "unauthenticated"
        ? false
        : null;

  // ---- seed page (deep-link splice + M2 composition happen server-side) ---
  const seedUrl = useMemo(
    () =>
      post
        ? `/api/tiktok/feed?post=${encodeURIComponent(post)}`
        : "/api/tiktok/feed",
    [post],
  );
  const {
    data: seedPage,
    loading: seedLoading,
    error: seedError,
    reload: reloadSeed,
  } = useApi<TikTokFeedPageDTO>(seedUrl);

  // ---- cursor pages appended in load order --------------------------------
  const [loadedPages, setLoadedPages] = useState<
    { items: TikTokVideoDTO[]; nextCursor: string | null }[]
  >([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);

  // M2: client-side imports splice FIRST (the importer sees the post now;
  // the server composition dedupes it out on the next reload).
  const [clientImports, setClientImports] = useState<TikTokVideoDTO[]>([]);
  // M3: the session-local hide (the ⋯ Not interested law) — the slide
  // leaves THIS viewing only; a reload restores the composed universe and
  // nothing is persisted (the honest no-persistence claim).
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(new Set());
  // M3 — the unified viewer-stamp overlay: viewer-scoped fields
  // (`visibility`/`owned`) applied LAST on the composed items, so a flip or
  // a per-item save re-renders EVERY row source (the client splice, a
  // loaded cursor page, AND the server-composed seed segment) without
  // touching the shared caches (the DB-free law: stamps live per-viewing).
  const [viewerStamps, setViewerStamps] = useState<Record<string, TikTokViewerStampOverlay>>({});

  const seedItems = seedPage?.items ?? [];
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: TikTokVideoDTO[] = [];
    for (const video of [
      ...clientImports,
      ...seedItems,
      ...loadedPages.flatMap((page) => page.items),
    ]) {
      if (hiddenIds.has(video.postId)) continue;
      if (seen.has(video.postId)) continue;
      seen.add(video.postId);
      const stamp = viewerStamps[video.postId];
      out.push(stamp ? { ...video, ...stamp } : video);
      if (out.length >= MAX_ITEMS) break;
    }
    return out;
  }, [clientImports, seedItems, loadedPages, hiddenIds, viewerStamps]);
  const nextCursor =
    loadedPages.length > 0
      ? loadedPages[loadedPages.length - 1].nextCursor
      : (seedPage?.nextCursor ?? null);

  const loadMore = useCallback(() => {
    if (loadingMoreRef.current) return;
    if (!nextCursor || items.length >= MAX_ITEMS) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    fetch(`/api/tiktok/feed?cursor=${encodeURIComponent(nextCursor)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as TikTokFeedPageDTO;
      })
      .then((page) => {
        setLoadedPages((prev) => [
          ...prev,
          { items: page.items, nextCursor: page.nextCursor },
        ]);
      })
      .catch((err: unknown) => {
        toast.error(
          err instanceof Error
            ? `Could not load more TikTok posts (${err.message})`
            : "Could not load more TikTok posts",
        );
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [nextCursor, items.length]);

  const onEnterLastTwo = useCallback(() => {
    loadMore();
  }, [loadMore]);

  const onVisibilityFlipped = useCallback((postId: string, visibility: TikTokImportVisibility) => {
    // The stamp overlay re-renders every row source at once (see the
    // viewerStamps law above); the stores keep their structural rows.
    setViewerStamps((prev) => ({ ...prev, [postId]: { ...prev[postId], visibility } }));
  }, []);

  const onRemoved = useCallback((postId: string) => {
    setClientImports((prev) => prev.filter((v) => v.postId !== postId));
    setLoadedPages((pages) =>
      pages.map((page) => ({
        ...page,
        items: page.items.filter((v) => v.postId !== postId),
      })),
    );
    // The stamp dies with the row; the seed page holds the composed
    // segment too — drop it there.
    setViewerStamps((prev) => {
      if (!(postId in prev)) return prev;
      const next = { ...prev };
      delete next[postId];
      return next;
    });
    reloadSeed();
  }, [reloadSeed]);

  const onImported = useCallback(
    (imported: TikTokVideoDTO) => {
      setClientImports((prev) => [imported, ...prev.filter((v) => v.postId !== imported.postId)]);
    },
    [],
  );

  // M3: the session-local hide — filter at the composed-items level (the
  // seed/loaded/client stores stay intact so a reload restores everything).
  const onHidden = useCallback((postId: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(postId);
      return next;
    });
  }, []);

  // M3: the per-item save stamps the viewer-owned fields through the SAME
  // overlay as the visibility flip — the server composition agrees on the
  // next fetch.
  const onSaved = useCallback((postId: string) => {
    setViewerStamps((prev) => ({
      ...prev,
      [postId]: { ...prev[postId], owned: true, visibility: "private" },
    }));
  }, []);

  const slideAriaLabel = useCallback(
    (item: TikTokVideoDTO) => item.title || (item.author ? `TikTok by @${item.author}` : "TikTok post"),
    [],
  );

  const state = seedLoading
    ? ({ kind: "loading", label: "Loading TikTok feed", spinnerClassName: "text-foreground" } as const)
    : seedError
      ? ({ kind: "error", message: `TikTok feed failed: ${seedError}`, onRetry: () => reloadSeed() } as const)
      : items.length === 0
        ? ({
            kind: "empty",
            message:
              "No TikTok posts in the shelf yet. Add one with the Add TikTok button — the official player already rides.",
          } as const)
        : ({ kind: "ready" } as const);

  return (
    <ShortsFeedShell<TikTokVideoDTO>
      state={state}
      ariaLabel="TikTok feed"
      chrome={
        <div className="flex w-full items-center gap-2">
          <ShortsSourceSelector source="tiktok" />
          {CAPS.canImport ? (
            <div className="ml-auto pr-4 sm:pr-6">
              <TikTokImportDialog authenticated={authenticated} onImported={onImported} />
            </div>
          ) : null}
        </div>
      }
      items={items}
      getItemKey={(item) => item.postId}
      slideAriaLabel={slideAriaLabel}
      onEnterLastTwo={onEnterLastTwo}
      loadingMore={loadingMore}
      loadingMoreLabel="Loading more TikToks"
      renderSlide={(item, control) => (
        <>
          {/* 9:16 player column — the SAME geometry wrapper as YouTube's
              slides (the one-experience law) */}
          <div className="relative aspect-[9/16] h-full w-auto max-w-full">
            <TikTokFeedPlayer item={item} active={control.active} />

            {/* bottom-left attribution overlay (gradient) — verified fields
                only, never fabricated (the work order's contract §6) */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 via-black/25 to-transparent p-4 pt-14">
              <div className="min-w-0 pr-16">
                <div className="flex items-center gap-2" data-testid="tiktok-shorts-attribution">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-[13px] font-bold text-white" aria-hidden="true">
                    ♪
                  </span>
                  {item.author ? (
                    item.authorUrl ? (
                      <a
                        href={item.authorUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pointer-events-auto w-fit truncate text-sm font-semibold text-white transition-opacity hover:opacity-80"
                      >
                        @{item.author}
                      </a>
                    ) : (
                      <span className="truncate text-sm font-semibold text-white">
                        @{item.author}
                      </span>
                    )
                  ) : null}
                  <span className="ml-auto rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    TikTok
                  </span>
                </div>

                {item.title ? (
                  <p className="mt-2 line-clamp-3 text-sm font-medium text-white/90" data-testid="tiktok-shorts-caption">
                    {item.title}
                  </p>
                ) : null}

                {/* M2 visibility chips — factual shelf membership, never a
                    metric: a private save is the owner's only; a public
                    import says so. Curated rows carry no chip. */}
                {item.visibility ? (
                  <p
                    className={
                      "mt-2 w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                      (item.visibility === "private"
                        ? "bg-white/15 text-white/90"
                        : "bg-emerald-600/70 text-white")
                    }
                    data-testid="tiktok-shorts-visibility"
                  >
                    {item.visibility === "private" ? "Only you" : "Imported"}
                  </p>
                ) : null}
              </div>
            </div>

            <TikTokFeedRail
              item={item}
              authenticated={authenticated}
              onVisibilityFlipped={onVisibilityFlipped}
              onRemoved={onRemoved}
              onHidden={onHidden}
              onSaved={onSaved}
            />

            {/* desktop prev/next chevrons (the shared pair) */}
            <ShortsSlideChevrons control={control} />
          </div>
        </>
      )}
    />
  );
}
