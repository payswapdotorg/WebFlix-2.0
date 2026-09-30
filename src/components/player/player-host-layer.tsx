"use client";

/**
 * WFX2-C-S — the persistent player host layer (miniplayer persistence).
 *
 * Mounted ONCE in the AppShell ABOVE the route tree (sibling of the hover
 * preview layer), it:
 * - renders the single YoutubePlayer into the persistent wrapper node via
 *   createPortal (the wrapper is re-parented imperatively by the manager —
 *   React never unmounts it; Close is the only destroy path);
 * - renders the YouTube-geometry miniplayer chrome (bottom-right ~400x225,
 *   progress bar, title/channel, close + expand) that the wrapper lands in
 *   whenever no watch page owns the player (survival matrix).
 */
import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Maximize2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { playerHost, usePlayerHost } from "@/lib/player/player-host";
import { YoutubePlayer } from "@/components/watch/youtube-player";

export function PlayerHostLayer() {
  const router = useRouter();
  const videoId = usePlayerHost((s) => s.videoId);
  const meta = usePlayerHost((s) => s.meta);
  const hostMode = usePlayerHost((s) => s.hostMode);
  const positionSec = usePlayerHost((s) => s.positionSec);
  const durationSec = usePlayerHost((s) => s.durationSec);
  const startSec = usePlayerHost((s) => s.startSec);

  // The persistent wrapper (created once via lazy state init — client only;
  // NEVER removed by React). A state initializer is the sanctioned pattern
  // for a render-visible one-time value (refs must not be read in render).
  const [wrapper] = useState<HTMLDivElement | null>(() =>
    typeof document !== "undefined" ? playerHost.ensureWrapper() : null,
  );

  // The miniplayer's video area (the wrapper's mini host).
  const setVideoArea = useCallback((el: HTMLDivElement | null) => {
    playerHost.registerMiniHost(el);
  }, []);

  const miniVisible = videoId !== null && hostMode === "mini";
  const isLive = durationSec === 0;
  const pct =
    durationSec > 0 ? Math.min(100, (positionSec / durationSec) * 100) : 0;

  const onExpand = useCallback(() => {
    const id = usePlayerHost.getState().videoId;
    if (id === null) return;
    const onWatch = window.location.pathname.startsWith("/watch");
    playerHost.expand(); // on /watch: inline + the page scrolls itself back
    if (!onWatch) router.push(`/watch/${id}`);
  }, [router]);

  const onClose = useCallback(() => {
    playerHost.close(); // the ONLY destroy path
  }, []);

  return (
    <>
      {/* The player itself — lives in the persistent wrapper node; React
          never removes this portal's container, so the iframe keeps
          playing across every route change and mode switch. */}
      {videoId !== null && wrapper !== null
        ? createPortal(
            <YoutubePlayer
              handleRef={playerHost.handleRef}
              videoId={videoId}
              startSec={startSec}
              onProgress={(sec, dur) => playerHost.progress(sec, dur)}
              onEnded={() => playerHost.ended()}
              onStateChange={(st) => playerHost.stateChange(st)}
            />,
            wrapper,
          )
        : null}

      {/* The miniplayer chrome — YouTube geometry: bottom-right ~400x225
          video + info bar with progress, title/channel, close + expand. */}
      {videoId !== null && (
        <div
          role="region"
          aria-label="Miniplayer"
          className={cn(
            "group fixed bottom-4 right-4 z-50 w-[min(400px,calc(100vw-2rem))] rounded-xl border border-border bg-background shadow-2xl transition-all duration-200",
            miniVisible
              ? "opacity-100"
              : "pointer-events-none translate-y-2 opacity-0",
          )}
        >
          <div className="relative aspect-video w-full overflow-hidden rounded-t-xl bg-black">
            {/* the wrapper (with the live iframe) lands here in mini mode */}
            <div ref={setVideoArea} className="absolute inset-0" />
            {!isLive && (
              <div
                role="progressbar"
                aria-label="Playback progress"
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                className="absolute inset-x-0 bottom-0 h-[3px] bg-white/20"
              >
                <div
                  className="h-full bg-yt-red transition-[width] duration-300 ease-linear"
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight">
                {meta?.title ?? ""}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {meta?.channelName ?? ""}
              </p>
            </div>
            <button
              type="button"
              onClick={onExpand}
              aria-label="Expand miniplayer"
              title="Expand"
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Maximize2 className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close miniplayer"
              title="Close"
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default PlayerHostLayer;
