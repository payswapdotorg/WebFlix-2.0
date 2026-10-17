"use client";

/**
 * WFX2-P23-C (G5) — the sound page view: /sound/<key>.
 *
 * youtube.com's own sound surface (measured 2026-10-17,
 * evidence/wfx2p23c/DISCOVERY.md + browse_audio_pivot_page1.json): a sound
 * card — the vertical 2:3 image (contentPreviewImageViewModel), the sound
 * title, the owner channel row (avatarStack: avatar + @handle) — above the
 * grid of shorts that use the sound (richItemRenderer.shortsLockupViewModel
 * items), with the browse continuation paging the grid ("N shorts" counts
 * the loaded grid honestly — the browse payload carries no total).
 *
 * Honest states (the P22-B family, never a synthesized grid):
 *  - 404 (no title AND no items served) → "This sound is not available
 *    right now" (youtube.com's own wording family).
 *  - read-failed (502) → the sound page could not be read — open it on
 *    youtube.com to check.
 */
import { useState } from "react";
import Link from "next/link";
import { Disc3, Loader2 } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
// the client-safe codec (pure functions — never the server innertube chain)
import { normalizeSoundKeyParam } from "@/lib/youtube/sound-key";
import type { SoundPageDTO } from "@/lib/youtube/sound";

export function SoundPageView({ soundKey }: { soundKey: string }) {
  // NEXT 16 MEASURED: page params arrive UNDECODED — normalizeSoundKeyParam
  // collapses the link form (…%253D) back to the raw token (…%3D), passing
  // an already-raw key through; the fetch then encodes the RAW token once
  // (the API route's own param decodes exactly once — dev-server verified).
  const rawToken = normalizeSoundKeyParam(soundKey);
  const { data, loading, error } = useApi<SoundPageDTO>(
    `/api/sound/${encodeURIComponent(rawToken)}`,
  );
  const [pages, setPages] = useState<SoundPageDTO[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  if (loading) return <SoundSkeleton />;
  if (error || !data) return <SoundErrorState message={error ?? "unknown"} />;

  // the loaded grid: the first read + the paged reads, deduped by short id
  const all = [...data.items];
  const seen = new Set(all.map((s) => s.id));
  for (const p of pages) {
    for (const s of p.items) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      all.push(s);
    }
  }
  const nextCursor = pages.length
    ? pages[pages.length - 1].nextCursor
    : data.nextCursor;
  const totalLoaded = data.items.length + pages.reduce((n, p) => n + p.items.length, 0);

  return (
    <main className="mx-auto max-w-[1754px] px-4 py-4 sm:px-6">
      {/* the sound card — youtube.com's own sound-surface header shape */}
      <header className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        {data.imageUrl ? (
          <img
            src={data.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="aspect-[2/3] w-28 shrink-0 rounded-xl object-cover sm:w-36"
          />
        ) : (
          <div className="flex aspect-[2/3] w-28 shrink-0 items-center justify-center rounded-xl bg-secondary sm:w-36">
            <Disc3 className="size-10 text-muted-foreground" aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="line-clamp-2 text-xl font-bold text-foreground sm:text-2xl">
            {data.title || "Sound"}
          </h1>
          {data.channel?.handle ? (
            <Link
              href={`/channel/${data.channel.handle}`}
              className="mt-2 flex w-fit items-center gap-2 rounded-full transition-opacity hover:opacity-80"
            >
              {data.channel.avatarUrl ? (
                <img
                  src={data.channel.avatarUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="size-6 rounded-full bg-secondary object-cover"
                />
              ) : null}
              <span className="text-sm font-medium text-foreground">
                @{data.channel.handle}
              </span>
            </Link>
          ) : null}
          {/* the count line — the LOADED grid, honestly (no upstream total) */}
          <p className="mt-1 text-[13px] text-muted-foreground" aria-live="polite">
            {totalLoaded > 0
              ? `${totalLoaded} short${totalLoaded === 1 ? "" : "s"}${nextCursor ? " · showing what loaded" : ""}`
              : "No shorts loaded for this sound yet."}
          </p>
        </div>
      </header>

      {/* the shorts grid — the house 9:16 tile ladder in a responsive grid */}
      {all.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">
          No shorts using this sound are served right now.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {all.map((short) => (
            <Link
              key={short.id}
              href="/shorts"
              aria-label={`Open Shorts: ${short.title || short.id}`}
              className="group flex flex-col gap-2"
            >
              <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-secondary">
                {short.thumbnailUrl ? (
                  <img
                    src={short.thumbnailUrl}
                    alt={short.title || "Short"}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                  />
                ) : null}
                {short.isLive ? (
                  <span className="absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded bg-yt-red px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    <span className="size-1.5 rounded-full bg-white" aria-hidden="true" />
                    Live
                  </span>
                ) : null}
              </div>
              <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                {short.title || "Short"}
              </p>
              <p className="-mt-1 text-[13px] text-muted-foreground">
                {short.viewsText ?? ""}
              </p>
            </Link>
          ))}
        </div>
      )}

      {/* the browse continuation paging — youtube.com's own grid paging */}
      {nextCursor ? (
        <div className="mt-6 flex flex-col items-center gap-2">
          <Button
            variant="secondary"
            disabled={loadingMore}
            onClick={() => {
              if (loadingMore) return;
              setLoadingMore(true);
              setMoreError(null);
              fetch(`/api/sound/${encodeURIComponent(nextCursor)}`)
                .then(async (res) => {
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  return (await res.json()) as SoundPageDTO;
                })
                .then((page) => setPages((prev) => [...prev, page]))
                .catch((e: unknown) => {
                  // honest failure: the error surfaces, the button retries
                  setMoreError(
                    e instanceof Error ? e.message : "Could not load more shorts",
                  );
                })
                .finally(() => setLoadingMore(false));
            }}
          >
            {loadingMore ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading
              </>
            ) : (
              "Show more"
            )}
          </Button>
          {moreError ? (
            <p className="text-xs text-muted-foreground" role="alert">
              Could not load more: {moreError}
            </p>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

function SoundSkeleton() {
  return (
    <main className="mx-auto max-w-[1754px] px-4 py-4 sm:px-6" aria-busy="true" aria-label="Loading sound">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <Skeleton className="aspect-[2/3] w-28 shrink-0 rounded-xl sm:w-36" />
        <div className="space-y-3">
          <Skeleton className="h-6 w-72 max-w-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="aspect-[9/16] w-full rounded-xl" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ))}
      </div>
    </main>
  );
}

function SoundErrorState({ message }: { message: string }) {
  const notServed = /not available|404/i.test(message);
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-6xl flex-col items-center justify-center px-4 py-16 text-center">
      <Disc3 className="size-10 text-muted-foreground" aria-hidden="true" />
      <h1 className="mt-4 text-2xl font-bold">
        {notServed ? "This sound is not available right now" : "The sound page could not be read"}
      </h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground" role="status">
        {notServed
          ? "The sound may have been removed, or YouTube didn't serve it to WebFlix. Open it on youtube.com to check."
          : "It may be temporarily unavailable on YouTube. Try again in a moment."}
      </p>
      <Link
        href="/shorts"
        className="mt-6 flex h-10 items-center rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground"
      >
        Back to Shorts
      </Link>
    </main>
  );
}
