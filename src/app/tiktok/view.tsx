"use client";

import Link from "next/link";
import { useApi } from "@/hooks/use-api";
import { TikTokCard } from "@/components/tiktok/tiktok-card";
import { Clapperboard, ExternalLink, Info } from "lucide-react";
import type { TikTokRailDTO } from "@/lib/tiktok/types";

/**
 * P58 — the TikTok hub (ADR 0004 §4, the /netflix pattern): the curated
 * universe as a grid, honest loading / degraded / empty states, and the
 * honest scope note (the curated list is the v1 universe; TIKTOK_CURATED_IDS
 * extends it without a deploy).
 */
export function TikTokHubView() {
  const { data, error } = useApi<TikTokRailDTO>("/api/tiktok/rail");

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6" data-testid="tiktok-hub">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-foreground text-background">
            <Clapperboard className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-foreground">TikTok</h1>
            <p className="text-xs text-muted-foreground">
              Curated shelf · played through TikTok&apos;s official embed player
            </p>
          </div>
        </div>
      </header>

      {data?.unavailable ? (
        <div
          role="status"
          className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-foreground"
          data-testid="tiktok-hub-degraded"
        >
          {data.unavailableReason}
        </div>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground"
          data-testid="tiktok-hub-error"
        >
          The TikTok shelf failed to load. Reload to try again.
        </div>
      ) : null}

      {!data && !error ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" data-testid="tiktok-hub-loading">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-lg bg-muted" style={{ aspectRatio: "9 / 16" }} />
          ))}
        </div>
      ) : null}

      {data ? (
        data.videos.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground" data-testid="tiktok-hub-empty">
            The curated TikTok shelf is empty. Set <code className="rounded bg-muted px-1">TIKTOK_CURATED_IDS</code>{" "}
            (comma-separated post URLs or ids) to curate it — no deploy needed.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" data-testid="tiktok-hub-grid">
            {data.videos.map((video) => (
              <TikTokCard key={video.postId} video={video} />
            ))}
          </div>
        )
      ) : null}

      {data && data.videos.length > 0 ? (
        <p className="mt-8 flex items-start gap-2 text-xs text-muted-foreground" data-testid="tiktok-hub-note">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Playback rides TikTok&apos;s official Embed Player with creator, description, and music attribution built in.
            {data.universeSize > 0 ? ` Curated universe: ${data.universeSize} post${data.universeSize === 1 ? "" : "s"}.` : null}{" "}
            <Link href="/tiktok" className="underline underline-offset-2">
              WebFlix owns browse
            </Link>
            ; TikTok owns the stream.
          </span>
          <ExternalLink className="mt-0.5 size-3 shrink-0" />
        </p>
      ) : null}
    </main>
  );
}
