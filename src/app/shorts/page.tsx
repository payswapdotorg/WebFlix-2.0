"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Pause, Play, SquarePlay } from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { formatViews } from "@/lib/format";
import { VerifiedBadge } from "@/components/app/verified-badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { ShortsPageDTO } from "@/lib/types";

/**
 * Shorts — vertical snap-scroll feed. Each short autoplays muted when in view
 * (IntersectionObserver), tap toggles play/pause. Full interactions land with
 * WFX2-D (Wave 3).
 */
export default function ShortsPage() {
  const { data, loading, error } = useApi<ShortsPageDTO>("/api/shorts");

  return (
    <div className="mx-auto max-w-[480px]">
      <h1 className="flex items-center gap-2 px-4 py-4 text-xl font-bold sm:px-6">
        <SquarePlay className="size-6 text-yt-red" strokeWidth={2.2} /> Shorts
      </h1>
      {loading &&
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="mb-4 px-4" aria-hidden="true">
            <Skeleton className="aspect-[9/16] w-full rounded-2xl" />
          </div>
        ))}
      {error && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground" role="alert">
          {error}
        </p>
      )}
      {data && data.shorts.length === 0 && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          No Shorts yet — Shorts are videos flagged as Shorts in the database.
        </p>
      )}
      {(data?.shorts ?? []).map((short) => (
        <ShortItem key={short.id} short={short} />
      ))}
    </div>
  );
}

function ShortItem({ short }: { short: ShortsPageDTO["shorts"][number] }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const node = videoRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
            void node
              .play()
              .then(() => setPlaying(true))
              .catch(() => undefined);
          } else {
            node.pause();
            setPlaying(false);
          }
        }
      },
      { threshold: [0, 0.6, 1] }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function togglePlay() {
    const node = videoRef.current;
    if (!node) return;
    if (node.paused) {
      void node
        .play()
        .then(() => setPlaying(true))
        .catch(() => undefined);
    } else {
      node.pause();
      setPlaying(false);
    }
  }

  return (
    <section className="mb-4 px-4" aria-label={short.title}>
      <div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl bg-black">
        <video
          ref={videoRef}
          src={short.videoUrl}
          poster={short.thumbnailUrl}
          muted={muted}
          loop
          playsInline
          preload="metadata"
          className="h-full w-full cursor-pointer object-cover"
          onClick={togglePlay}
        />
        {!playing && (
          <button
            type="button"
            onClick={togglePlay}
            aria-label="Play short"
            className="absolute inset-0 m-auto flex size-14 items-center justify-center rounded-full bg-black/60 text-white"
          >
            <Play className="size-8 fill-white" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? "Unmute" : "Mute"}
          className="absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white"
        >
          {muted ? "Unmute" : "Mute"}
        </button>
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-10">
          <Link
            href={`/channel/${short.channel.handle}`}
            className="pointer-events-auto flex items-center gap-2 text-sm font-semibold text-white"
          >
            <img
              src={short.channel.avatarUrl}
              alt=""
              className="size-8 rounded-full object-cover"
            />
            {short.channel.name}
            {short.channel.verified && <VerifiedBadge />}
          </Link>
          <p className="mt-2 line-clamp-2 text-sm text-white/90">{short.title}</p>
          <p className="mt-1 text-xs text-white/70">{formatViews(short.views)}</p>
        </div>
      </div>
    </section>
  );
}
