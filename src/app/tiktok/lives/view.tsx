"use client";

/**
 * P102 — the honest live board (/tiktok/lives, G27): the currently-live
 * rooms of the WebFlix universe (the curated authors + the public import
 * authors — the SAME composition the feed follows). Every state is honest:
 *  - probing → "Checking who is live…" (never a fake empty);
 *  - rooms → the live grid (cover, title, viewers, creator → the room page);
 *  - an all-offline universe → the honest empty + the scope statement
 *    (tiktok.com's LIVE-tab discovery is API-unreliable — the board's scope
 *    is the universe, and the UI says so);
 *  - degraded → the API's real error copy (502/503), poller stopped.
 */
import Link from "next/link";
import { Radio, TriangleAlert } from "lucide-react";

import { useTikTokLiveBoard } from "@/hooks/use-tiktok-live-board";
import { TikTokLiveBadge } from "@/components/tiktok/tiktok-live-badge";
import { TikTokThumbnailImage } from "@/components/tiktok/tiktok-thumbnail-image";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount } from "@/lib/format";
import { tiktokChannelHref } from "@/lib/tiktok/urls";

export function TikTokLivesBoardView({ boardPollMs = 15_000 }: { boardPollMs?: number }) {
  const { board, error } = useTikTokLiveBoard(boardPollMs);
  const rooms = (board?.rooms ?? []).filter((r) => r.live === true);

  return (
    <div className="mx-auto max-w-[1284px] px-4 pb-16 pt-6 sm:px-6" data-testid="tiktok-lives-in-app">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold sm:text-xl">TikTok lives</h1>
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
          {rooms.length > 0 ? `${rooms.length} live now` : "the universe's live lane"}
        </span>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        The live lane polls the creators in the WebFlix universe — the curated shelf plus every
        imported post&apos;s author. TikTok.com&apos;s full LIVE-tab discovery is not API-honest,
        so this board never claims more than it checks.
      </p>

      {error ? (
        <div data-testid="tiktok-lives-degraded" className="mx-auto max-w-xl py-16 text-center">
          <TriangleAlert className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-semibold">The live board is unavailable right now</h2>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        </div>
      ) : !board || board.probing === true ? (
        <div data-testid="tiktok-lives-probing" className="py-8" aria-live="polite">
          <p className="text-sm text-muted-foreground">Checking who is live…</p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="aspect-video w-full rounded-lg" />
            <Skeleton className="aspect-video w-full rounded-lg" />
            <Skeleton className="aspect-video w-full rounded-lg" />
          </div>
        </div>
      ) : rooms.length === 0 ? (
        <div
          data-testid="tiktok-lives-empty"
          className="mx-auto max-w-xl py-16 text-center"
        >
          <Radio className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-semibold">Nobody in the universe is live right now</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            WebFlix checked every creator just now. Import a post from a live creator and this
            board picks them up on the next sweep.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="tiktok-lives-board">
          {rooms.map((room) => (
            <Link
              key={room.handle}
              href={`/tiktok/${room.handle}/live`}
              data-testid="tiktok-lives-room"
              className="group overflow-hidden rounded-lg border bg-card transition-colors hover:border-primary/40"
            >
              <div className="relative aspect-video w-full overflow-hidden bg-secondary">
                {room.room?.coverUrl ? (
                  <TikTokThumbnailImage
                    src={room.room.coverUrl}
                    alt={`${room.room.title ?? `@${room.handle}`} live cover`}
                    className="size-full object-cover transition-transform group-hover:scale-[1.02]"
                    fallback={<div className="size-full bg-secondary" />}
                  />
                ) : (
                  <div className="flex size-full items-center justify-center bg-secondary">
                    <Radio className="size-8 text-muted-foreground" aria-hidden="true" />
                  </div>
                )}
                <span className="absolute left-2 top-2">
                  <TikTokLiveBadge status={room} />
                </span>
              </div>
              <div className="p-3">
                <p className="truncate text-sm font-semibold">{room.room?.title ?? `@${room.handle} is live`}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  @{room.handle}
                  {typeof room.room?.viewers === "number" ? ` · ${formatCount(room.room.viewers)} watching` : ""}
                  {room.source ? ` · via ${room.source}` : ""}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      <p className="mt-8 text-xs text-muted-foreground">
        Creator pages:{" "}
        <Link href="/tiktok" className="underline underline-offset-4">
          back to the TikTok hub
        </Link>{" "}
        · the room pages carry the watch-party chat and the honest outbound TikTok actions.
        Channel pages live at {tiktokChannelHref("scout2015")} — the same URL law everywhere.
      </p>
    </div>
  );
}
