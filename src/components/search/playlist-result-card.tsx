"use client";

import Link from "next/link";
import { AudioLines, ListVideo } from "lucide-react";
import type { PlaylistLiteDTO } from "@/lib/types";

/**
 * Playlist result card (search parity): the collection thumbnail stack
 * (real collectionThumbnailViewModel sources), the video-count overlay
 * badge, owner + updated text → the playlist page.
 *
 * REA-1 G19 (measured live 2026-10-17): a MIX card (RD…) carries youtube.com's
 * MIX badge (the thumbnail's bottom-end overlay: the mix icon + "Mix") and
 * its click is START RADIO — /watch?v=<seed>&list=RD…&start_radio=1 — the
 * watch page's queue panel (the mix's own shuffled order + infinite
 * autoload), NOT the playlist page (which youtube.com answers "This
 * playlist type is unviewable."). When the seed cannot be extracted from
 * the renderer's own data, the card keeps the playlist-page link — the
 * honest unviewable note stands there.
 */
export function PlaylistResultCard({ playlist }: { playlist: PlaylistLiteDTO }) {
  const isMix = playlist.isMix === true;
  const mixHref =
    isMix && playlist.mixSeedVideoId
      ? `/watch/${playlist.mixSeedVideoId}?list=${encodeURIComponent(playlist.id)}&start_radio=1`
      : null;
  const href = mixHref ?? `/playlist/${playlist.id}`;

  return (
    <article className="flex gap-4 border-b border-border/40 py-4 last:border-b-0">
      <Link
        href={href}
        aria-label={isMix ? `Start radio: ${playlist.title}` : `Open playlist ${playlist.title}`}
        data-testid={isMix ? "mix-result-card" : "playlist-result-card"}
        className="relative block w-[168px] shrink-0 overflow-hidden rounded-xl bg-secondary sm:w-[246px]"
      >
        {playlist.thumbnailUrl ? (
          <img
            src={playlist.thumbnailUrl}
            alt={playlist.title}
            loading="lazy"
            className="aspect-video w-full object-cover"
          />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center" aria-hidden>
            <ListVideo className="size-8 text-muted-foreground" />
          </div>
        )}
        {/* the collection stack bar (the real playlist-stack affordance) */}
        <div
          className="absolute bottom-0 right-0 top-0 w-2 bg-gradient-to-t from-border via-border/70 to-transparent"
          aria-hidden
        />
        {isMix ? (
          /* youtube.com's measured MIX badge — the thumbnail's bottom-end
             overlay: the mix icon + "Mix" text on the dark scrim */
          <span
            className="absolute bottom-1.5 right-3 inline-flex items-center gap-1 rounded-sm bg-black/80 px-1.5 py-0.5 text-[11px] font-medium text-white"
            data-testid="mix-badge"
          >
            <AudioLines className="size-3" aria-hidden />
            Mix
          </span>
        ) : (
          <span className="absolute bottom-1.5 right-3 rounded-sm bg-black/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
            {playlist.videoCountText ?? `${playlist.videoCount} videos`}
          </span>
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={href}>
          <h3 className="line-clamp-2 text-base font-medium text-foreground sm:text-lg">
            {playlist.title}
          </h3>
        </Link>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {playlist.channelName}
          {playlist.updatedText ? ` · ${playlist.updatedText}` : ""}
        </p>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {isMix ? "Mix · Start radio" : "Playlist"}
        </p>
      </div>
    </article>
  );
}
