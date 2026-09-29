"use client";

import Link from "next/link";
import { ListVideo } from "lucide-react";
import type { PlaylistLiteDTO } from "@/lib/types";

/**
 * Playlist result card (search parity): the collection thumbnail stack
 * (real collectionThumbnailViewModel sources), the video-count overlay
 * badge, owner + updated text → the playlist page.
 */
export function PlaylistResultCard({ playlist }: { playlist: PlaylistLiteDTO }) {
  return (
    <article className="flex gap-4 border-b border-border/40 py-4 last:border-b-0">
      <Link
        href={`/playlist/${playlist.id}`}
        aria-label={`Open playlist ${playlist.title}`}
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
        <span className="absolute bottom-1.5 right-3 rounded-sm bg-black/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
          {playlist.videoCountText ?? `${playlist.videoCount} videos`}
        </span>
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/playlist/${playlist.id}`}>
          <h3 className="line-clamp-2 text-base font-medium text-foreground sm:text-lg">
            {playlist.title}
          </h3>
        </Link>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {playlist.channelName}
          {playlist.updatedText ? ` · ${playlist.updatedText}` : ""}
        </p>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {playlist.isMix ? "Mix" : "Playlist"}
        </p>
      </div>
    </article>
  );
}
