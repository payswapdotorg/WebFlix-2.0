"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  History as HistoryIcon,
  MoreVertical,
  Pause,
  Play,
  Search,
  SquarePlay,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useApi } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { displayViews, watchProgress } from "@/lib/format";
import type { ContinueVideoDTO, HistoryGroupDTO } from "@/lib/types";
import { PersonalSurfaceGate } from "@/components/auth/personal-surface-gate";

type HistoryPayload = {
  groups: HistoryGroupDTO[];
  nextCursor: string | null;
  loginRequired: boolean;
  watchHistoryPaused: boolean | null;
  searchHistoryPaused: boolean | null;
  total: number;
  session: boolean;
};

/**
 * REA-3 F2 — youtube.com's history TAB family (station pack, logged-in
 * 2026-10-17: "tabs All / Music / PODCASTS / Shorts / Videos"). WebFlix
 * ships the honest subset the real history payload can filter:
 *   - All / Shorts / Videos — the isShort signal is REAL (the mapper maps
 *     the page's own watched-shorts shelves, reelShelfRenderer);
 *   - Music / Podcasts are HONESTLY ABSENT: youtube.com classifies history
 *     rows server-side; the history payload carries no genre seam, and no
 *     existing WebFlix seam can filter your history by music/podcasts — a
 *     tab that guesses would fabricate (the REA-3 parity-debt ledger).
 */
type HistoryTab = "all" | "shorts" | "videos";
const HISTORY_TABS: { id: HistoryTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "shorts", label: "Shorts" },
  { id: "videos", label: "Videos" },
];

/**
 * The honest no-session state (P22-B): NEVER a "Sign in to …" ask — the
 * viewer is already signed in to WebFlix (the gate passed); what's missing
 * is the deployment's YouTube session, which no WebFlix sign-in can fix.
 * youtube.com never asks a signed-in viewer to sign in again.
 */
function HistoryUnavailableNote({ session }: { session: boolean }) {
  return (
    <div className="px-4 py-16 text-center sm:px-6" role="status">
      <p className="text-lg font-medium">Watch history is unavailable right now</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        History is personal to the YouTube account this WebFlix deployment rides (single-tenant
        live mode).{" "}
        {session
          ? "The YouTube session is connected but didn't serve your watch history — open it on youtube.com to check."
          : "No YouTube session is connected to this deployment yet — your WebFlix sign-in is fine; the operator session (YT_COOKIES) needs to be connected."}
      </p>
    </div>
  );
}

/**
 * History — the operator's REAL YouTube watch history (SSR /feed/history),
 * in youtube.com's own history-page layout (2026-10-16 operator pass):
 *
 *  - TWO COLUMNS on desktop — the day-grouped ROW LIST (compact horizontal
 *    lockups: fixed 246px 16:9 thumbnail + title/channel/meta text block,
 *    exactly youtube.com/feed/history's rows — never the wide home-grid
 *    cards) + the right HISTORY CONTROLS rail (the history-type list +
 *    Clear all / Pause, youtube.com's own panel);
 *  - the "Search watch history" box above the list filters the loaded
 *    history client-side (title + channel substring), flat rows while
 *    filtering — youtube.com's own behavior;
 *  - watched-progress rides the thumbnail (the red bar), the ⋯ row menu
 *    keeps Remove-from-history, and Pause/Clear live in the rail (with a
 *    compact header fallback on mobile, where youtube.com folds the rail).
 */
export default function HistoryPage() {
  return (
    <PersonalSurfaceGate surface="history">
      <HistoryContent />
    </PersonalSurfaceGate>
  );
}

function HistoryContent() {
  const { data, loading, error, reload } = useApi<HistoryPayload>("/api/history");
  const [clearing, setClearing] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [extraGroups, setExtraGroups] = useState<HistoryGroupDTO[]>([]);
  const [paging, setPaging] = useState<{ cursor: string | null; loading: boolean }>({
    cursor: null,
    loading: false,
  });
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<HistoryTab>("all");

  const total = data?.total ?? 0;
  const paused = data?.watchHistoryPaused ?? null;
  const allGroups = useMemo(
    () => [...(data?.groups ?? []), ...extraGroups],
    [data?.groups, extraGroups],
  );

  /** The tab filter (youtube.com's type tabs) rides the REAL isShort signal. */
  const tabMatches = useMemo(
    () => (item: ContinueVideoDTO) =>
      tab === "all" ? true : tab === "shorts" ? item.isShort : !item.isShort,
    [tab],
  );

  /** The search filter (youtube.com's "Search watch history") — client-side,
 * scoped to the active tab (youtube.com searches within the tab). */
  const filteredGroups = useMemo(() => {
    const scoped = allGroups
      .map((g) => ({ ...g, items: g.items.filter(tabMatches) }))
      .filter((g) => g.items.length > 0);
    const q = query.trim().toLowerCase();
    if (!q) return scoped;
    const hits: ContinueVideoDTO[] = [];
    for (const g of scoped) {
      for (const item of g.items) {
        const hay = `${item.title} ${item.channel?.name ?? ""}`.toLowerCase();
        if (hay.includes(q)) hits.push(item);
      }
    }
    return hits.length > 0 ? [{ label: "Search results", items: hits }] : [];
  }, [allGroups, query, tabMatches]);

  async function clearHistory() {
    setClearing(true);
    try {
      const res = await fetch("/api/history", { method: "DELETE" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast.success("Watch history cleared");
      setExtraGroups([]);
      setPaging({ cursor: null, loading: false });
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear history");
    } finally {
      setClearing(false);
    }
  }

  async function togglePause() {
    setPausing(true);
    try {
      const res = await fetch("/api/history", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: !(paused ?? false), type: "watch" }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; effect?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast.success(body.effect === "paused" ? "Watch history paused" : "Watch history resumed");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to toggle history");
    } finally {
      setPausing(false);
    }
  }

  async function removeFromHistory(videoId: string) {
    try {
      const res = await fetch(`/api/history?videoId=${encodeURIComponent(videoId)}`, {
        method: "DELETE",
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast.success("Removed from watch history");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    }
  }

  async function loadMore() {
    const cursor = paging.cursor ?? data?.nextCursor ?? null;
    if (!cursor) return;
    setPaging({ cursor, loading: true });
    try {
      const res = await fetch(`/api/history?cursor=${encodeURIComponent(cursor)}`);
      const body = (await res.json()) as HistoryPayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      // append (merge same-label day groups like the first page does)
      setExtraGroups((prev) => {
        const merged = prev.map((g) => ({ ...g, items: [...g.items] }));
        for (const g of body.groups) {
          const hit = merged.find((m) => m.label === g.label);
          if (hit) hit.items.push(...g.items);
          else merged.push({ ...g, items: [...g.items] });
        }
        return merged;
      });
      setPaging({ cursor: body.nextCursor, loading: false });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load more");
      setPaging({ cursor, loading: false });
    }
  }

  const hasMore = !query.trim() && Boolean(paging.cursor ?? data?.nextCursor);

  return (
    <div className="pb-6">
      {/* page header — youtube.com carries the controls in the side rail; on
          mobile (rail hidden) the compact buttons stay in the header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
          <HistoryIcon className="size-7 text-yt-red" /> Watch history
        </h1>
        <div className="flex items-center gap-2 lg:hidden">
          {total > 0 && paused !== null && (
            <Button
              variant="ghost"
              onClick={togglePause}
              disabled={pausing}
              className="rounded-full text-sm text-muted-foreground hover:text-foreground"
              aria-label={paused ? "Resume watch history" : "Pause watch history"}
            >
              {paused ? <Play className="mr-2 size-4" /> : <Pause className="mr-2 size-4" />}
              {paused ? "Resume" : "Pause"}
            </Button>
          )}
          {total > 0 && (
            <Button
              variant="ghost"
              onClick={clearHistory}
              disabled={clearing}
              className="rounded-full text-sm text-muted-foreground hover:text-foreground"
              aria-label="Clear all watch history"
            >
              <Trash2 className="mr-2 size-4" /> Clear all
            </Button>
          )}
        </div>
      </div>

      {paused === true && total > 0 && (
        <p className="px-4 pb-2 text-xs text-muted-foreground sm:px-6" role="status">
          Watch history is paused — videos you watch won&apos;t be recorded until you resume.
        </p>
      )}

      <div className="grid gap-6 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_240px] xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* ---------------- main column: tabs + search + the row list ---------------- */}
        <div className="min-w-0">
          {/* REA-3 F2 — youtube.com's history tab family (the honest subset:
              All / Shorts / Videos on the REAL isShort signal; Music/Podcasts
              need a server-side genre seam youtube.com owns — parity-debt). */}
          {total > 0 && (
            <div
              role="tablist"
              aria-label="History type"
              className="no-scrollbar mb-4 flex gap-2 overflow-x-auto"
              data-testid="history-tabs"
            >
              {HISTORY_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  data-testid={`history-tab-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium leading-none transition-colors",
                    tab === t.id
                      ? "bg-foreground text-background"
                      : "bg-secondary text-foreground/90 hover:bg-accent",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* "Search watch history" — youtube.com's own box over the list */}
          {total > 0 && (
            <div className="relative mb-4 max-w-[540px]">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search watch history"
                aria-label="Search watch history"
                className="h-10 rounded-full border-border bg-background pl-9 pr-9 text-sm"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          )}

          {loading &&
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-4 py-3" aria-hidden="true">
                <Skeleton className="aspect-video w-[246px] shrink-0 rounded-lg" />
                <div className="flex-1 space-y-2 pt-1">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-3.5 w-1/4" />
                </div>
              </div>
            ))}
          {error && (
            <p className="py-10 text-center text-sm text-muted-foreground" role="alert">
              {error}
            </p>
          )}
          {data && data.loginRequired && <HistoryUnavailableNote session={data.session} />}
          {data && !data.loginRequired && total === 0 && (
            <div className="py-16 text-center">
              <p className="text-lg font-medium">No watch history yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Videos you watch are recorded by YouTube itself — watch something from{" "}
                <Link href="/" className="text-foreground underline underline-offset-2">
                  the home feed
                </Link>{" "}
                and it lands here.
              </p>
            </div>
          )}

          {/* REA-3 — the honest per-tab empty (history exists, the tab's
              subset doesn't — never a fabricated row to fill it) */}
          {data && !data.loginRequired && total > 0 && filteredGroups.length === 0 && !query.trim() && !loading && (
            <div className="py-16 text-center" role="status">
              <p className="text-lg font-medium">
                {tab === "shorts" ? "No Shorts in your watch history" : "No videos in your watch history"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {tab === "shorts"
                  ? "Shorts you watch on YouTube land here — watch a few from the Shorts feed."
                  : "Long-form videos you watch land here — watch something from the home feed."}
              </p>
            </div>
          )}

          {filteredGroups.map((group) => {
            // REA-3 F2 — a day group splits into the ROWS (long-form lockups)
            // and its watched-shorts shelf (9:16 tiles, youtube.com's own
            // history composition); the shelf rides at its watch position
            // (first when the group's own order starts with a short).
            const rows = group.items.filter((i) => !i.isShort);
            const shorts = group.items.filter((i) => i.isShort);
            const shortsFirst = group.items[0]?.isShort === true;
            return (
              <section key={group.label} aria-label={`${group.label} history`} className="mb-2">
                <h2 className="pb-2 pt-4 text-base font-medium text-foreground">
                  {group.label}
                </h2>
                {shortsFirst && shorts.length > 0 && (
                  <HistoryShortsShelf
                    shorts={shorts}
                    onRemove={removeFromHistory}
                  />
                )}
                {rows.length > 0 && (
                  <div className="space-y-1">
                    {rows.map((item: ContinueVideoDTO) => (
                      <HistoryRow
                        key={item.id}
                        item={item}
                        onRemove={() => removeFromHistory(item.id)}
                      />
                    ))}
                  </div>
                )}
                {!shortsFirst && shorts.length > 0 && (
                  <HistoryShortsShelf
                    shorts={shorts}
                    onRemove={removeFromHistory}
                  />
                )}
              </section>
            );
          })}

          {query.trim() &&
            filteredGroups.length === 0 &&
            total > 0 &&
            !loading &&
            data &&
            !data.loginRequired && (
              <p className="py-10 text-center text-sm text-muted-foreground" role="status">
                No history results for &ldquo;{query.trim()}&rdquo;
              </p>
            )}

          {hasMore && (
            <div className="flex justify-center py-6">
              <Button
                variant="secondary"
                className="rounded-full"
                onClick={loadMore}
                disabled={paging.loading}
              >
                {paging.loading ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </div>

        {/* ---------------- the history controls rail (youtube.com's panel) ---- */}
        {total > 0 ? (
          <aside
            aria-label="History controls"
            className="hidden w-full max-w-[300px] lg:block"
          >
            <div className="rounded-xl border border-border/60 bg-secondary/40 p-4">
              <h2 className="mb-3 text-base font-medium text-foreground">History</h2>
              <ul className="space-y-1 text-sm">
                <li>
                  <span className="flex items-center gap-3 rounded-lg bg-accent px-3 py-2 font-medium text-foreground">
                    <HistoryIcon className="size-4" aria-hidden="true" /> Watch history
                  </span>
                </li>
              </ul>
              <div className="my-3 border-t border-border/60" />
              <ul className="space-y-1 text-sm">
                {paused !== null && (
                  <li>
                    <button
                      type="button"
                      onClick={togglePause}
                      disabled={pausing}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                    >
                      {paused ? (
                        <Play className="size-4" aria-hidden="true" />
                      ) : (
                        <Pause className="size-4" aria-hidden="true" />
                      )}
                      {paused ? "Resume watch history" : "Pause watch history"}
                    </button>
                  </li>
                )}
                <li>
                  <button
                    type="button"
                    onClick={clearHistory}
                    disabled={clearing}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    Clear all watch history
                  </button>
                </li>
              </ul>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One history ROW — youtube.com/feed/history's compact horizontal lockup:
 * fixed-width 16:9 thumbnail (246px, the red watched-progress bar on its
 * bottom edge) + the text block (title 2-line, channel, views · published).
 * The wide home-grid VideoCard NEVER rides this page (the operator's
 * "videos too wide" report).
 */
function HistoryRow({ item, onRemove }: { item: ContinueVideoDTO; onRemove: () => void }) {
  const progress = watchProgress(item.watchedSec, item.durationSec ?? 0);
  const finished = progress >= 0.95;
  const meta =
    item.viewsText ?? (item.views > 0 ? displayViews(item) : null);
  const sub = [meta, item.publishedText].filter(Boolean).join(" · ");

  return (
    <div className="group/row py-2">
      <div className="flex gap-4">
        <Link
          href={`/watch/${item.id}`}
          className="relative block w-[160px] shrink-0 overflow-hidden rounded-lg bg-secondary sm:w-[246px]"
          aria-label={`Watch ${item.title}`}
        >
          <div className="aspect-video w-full">
            {item.thumbnailUrl ? (
              <img
                src={item.thumbnailUrl}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
          {/* watched-progress — youtube.com's red bar on the thumbnail edge */}
          {progress > 0.02 ? (
            <div
              className="absolute inset-x-0 bottom-0 h-1 bg-white/30"
              aria-hidden="true"
            >
              <div
                className="h-full bg-yt-red"
                style={{ width: `${Math.min(100, progress * 100)}%` }}
              />
            </div>
          ) : null}
        </Link>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-start justify-between gap-2">
            <Link
              href={`/watch/${item.id}`}
              className="line-clamp-2 min-w-0 text-sm font-medium leading-snug text-foreground sm:text-base"
            >
              {item.title}
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 rounded-full text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover/row:opacity-100 aria-expanded:opacity-100"
                  aria-label={`Actions for ${item.title}`}
                >
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={onRemove}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 size-4" /> Remove from watch history
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <p className="mt-1 text-xs text-muted-foreground sm:text-[13px]">
            {item.channel?.name ?? ""}
            {item.channel?.verified ? " ✓" : ""}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-[13px]">
            {sub || (finished ? "Watched" : null)}
          </p>
          {progress > 0.02 && !finished ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Stopped at {Math.floor(item.watchedSec / 60)}:
              {String(item.watchedSec % 60).padStart(2, "0")}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * REA-3 F2 — a day group's watched SHORTS, in youtube.com's own history
 * presentation: a horizontal shelf of compact 9:16 tiles (never squashed
 * into the 16:9 row lockup), each tile opening the video's watch page and
 * carrying the same per-row ⋯ remove affordance. Shorts carry no
 * watched-progress bar (youtube.com's own shelf shows none — the mapper
 * records watchedSec 0, honestly).
 */
function HistoryShortsShelf({
  shorts,
  onRemove,
}: {
  shorts: ContinueVideoDTO[];
  onRemove: (videoId: string) => void;
}) {
  return (
    <div className="mb-3" aria-label="Shorts watched this day">
      <p className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
        <SquarePlay className="size-4 text-yt-red" aria-hidden="true" /> Shorts
      </p>
      <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1" data-testid="history-shorts-shelf">
        {shorts.map((short) => (
          <HistoryShortTile key={short.id} short={short} onRemove={() => onRemove(short.id)} />
        ))}
      </div>
    </div>
  );
}

function HistoryShortTile({
  short,
  onRemove,
}: {
  short: ContinueVideoDTO;
  onRemove: () => void;
}) {
  return (
    <div className="group/tile relative w-[128px] shrink-0 sm:w-[160px]">
      <Link
        href={`/watch/${short.id}`}
        aria-label={`Watch ${short.title}`}
        className="block overflow-hidden rounded-xl bg-secondary"
      >
        <div className="relative aspect-[9/16] w-full">
          {short.thumbnailUrl ? (
            <img
              src={short.thumbnailUrl}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover/tile:scale-105"
            />
          ) : null}
        </div>
      </Link>
      <div className="absolute right-1 top-1 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-full bg-black/60 text-white opacity-0 transition-opacity focus-visible:opacity-100 group-hover/tile:opacity-100 aria-expanded:opacity-100"
              aria-label={`Actions for ${short.title}`}
            >
              <MoreVertical className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={onRemove}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 size-4" /> Remove from watch history
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs font-medium leading-snug text-foreground">
        {short.title}
      </p>
      {short.viewsText ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{short.viewsText}</p>
      ) : null}
    </div>
  );
}
