"use client";

/**
 * WFX2-A-W YouTube player — the REAL player (Tier 3 PLAYBACK).
 *
 * IFrame Player API (`https://www.youtube.com/iframe_api`, `new YT.Player`):
 * plays any public YouTube video INCLUDING live streams — quality, speed,
 * captions, keyboard, fullscreen all come from YouTube's own player UI
 * (it IS youtube.com's player — the same experience by construction).
 *
 * Props: {videoId, startSec?, onProgress?(sec, durationSec), onEnded?,
 * onStateChange?(state), className?} — `className="shorts"` renders the
 * 9:16 slot the Shorts page (A-S) reuses.
 *
 * Lifecycle: loads the iframe_api once per page; `loadVideoById` on
 * videoId change (no iframe reload); destroy() on unmount.
 *
 * Progress: onProgress throttled to ~1/sec; position persisted to
 * localStorage `webflix-progress:<videoId>` (continue-watching UX); one
 * view ping per session to /api/view {videoId, watchedSec} (the existing
 * route contract). LIVE streams (duration 0) skip seek + persistence.
 */
import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { cn } from "@/lib/utils";

export type YoutubePlayerState =
  | "unstarted"
  | "ended"
  | "playing"
  | "paused"
  | "buffering"
  | "cued"
  | "error";

const STATE_NAMES: Record<number, YoutubePlayerState> = {
  [-1]: "unstarted",
  0: "ended",
  1: "playing",
  2: "paused",
  3: "buffering",
  5: "cued",
};

export interface YoutubePlayerHandle {
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seekTo: (sec: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
}

interface YTPlayerInstance {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  loadVideoById(options: { videoId: string; startSeconds?: number }): void;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement | string,
    options: Record<string, unknown>
  ) => YTPlayerInstance;
  PlayerState: Record<string, number>;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const PROGRESS_KEY = (videoId: string) => `webflix-progress:${videoId}`;
const VIEW_KEY = (videoId: string) => `webflix-view:${videoId}`;
const PROGRESS_INTERVAL_MS = 1000;
const PERSIST_EVERY_TICKS = 5; // ~5s

/* ---------- iframe_api loader (once per page) ---------- */

let apiPromise: Promise<YTNamespace> | null = null;

export function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("SSR — no window"));
  }
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        prev?.();
      } catch {
        /* previous handler's errors are not ours */
      }
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YT iframe API loaded without Player"));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("failed to load iframe_api"));
    document.head.appendChild(script);
    // belt-and-braces: the API may already be present (injected elsewhere)
    const t0 = Date.now();
    const poll = setInterval(() => {
      if (window.YT?.Player) {
        clearInterval(poll);
        resolve(window.YT);
      } else if (Date.now() - t0 > 20000) {
        clearInterval(poll);
        reject(new Error("iframe_api timeout"));
      }
    }, 250);
    setTimeout(() => clearInterval(poll), 21000);
  });
  return apiPromise;
}

/* ---------- progress memory ---------- */

export function readProgress(videoId: string): number | null {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY(videoId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sec?: number };
    return typeof parsed.sec === "number" && parsed.sec > 0 ? parsed.sec : null;
  } catch {
    return null;
  }
}

function persistProgress(videoId: string, sec: number): void {
  try {
    localStorage.setItem(PROGRESS_KEY(videoId), JSON.stringify({ sec, updatedAt: Date.now() }));
  } catch {
    /* private mode / quota — progress memory is best-effort */
  }
}

function viewAlreadyPinged(videoId: string): boolean {
  try {
    return sessionStorage.getItem(VIEW_KEY(videoId)) === "1";
  } catch {
    return true; // can't write → don't spam
  }
}

function markViewPinged(videoId: string): void {
  try {
    sessionStorage.setItem(VIEW_KEY(videoId), "1");
  } catch {
    /* best-effort */
  }
}

/** Fire the view ping once per session (existing /api/view contract). */
async function pingView(videoId: string, watchedSec: number): Promise<void> {
  if (viewAlreadyPinged(videoId)) return;
  markViewPinged(videoId);
  try {
    await fetch("/api/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoId, watchedSec: Math.max(0, Math.floor(watchedSec)) }),
    });
  } catch {
    /* offline/demo id — the ping is fire-and-forget */
  }
}

/* ---------- the component ---------- */

export interface YoutubePlayerProps {
  videoId: string;
  /** seek here once the player is ready (resume / ?t= share links) */
  startSec?: number | null;
  /** ~1/sec while playing */
  onProgress?: (sec: number, durationSec: number) => void;
  onEnded?: () => void;
  onStateChange?: (state: YoutubePlayerState) => void;
  /** "shorts" → the 9:16 slot for the Shorts page */
  className?: string;
  handleRef?: Ref<YoutubePlayerHandle>;
}

export function YoutubePlayer({
  videoId,
  startSec,
  onProgress,
  onEnded,
  onStateChange,
  className,
  handleRef,
}: YoutubePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickCountRef = useRef(0);
  const startAppliedRef = useRef(false);
  const liveRef = useRef(false);

  // stable callbacks (the player events live across renders)
  const onProgressRef = useRef(onProgress);
  const onEndedRef = useRef(onEnded);
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => {
    onProgressRef.current = onProgress;
    onEndedRef.current = onEnded;
    onStateChangeRef.current = onStateChange;
  });

  const stopProgressLoop = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const savePosition = useCallback(() => {
    const p = playerRef.current;
    if (!p || liveRef.current) return;
    try {
      const sec = p.getCurrentTime();
      if (Number.isFinite(sec) && sec > 0) persistProgress(videoId, sec);
    } catch {
      /* player gone */
    }
  }, [videoId]);

  const handleState = useCallback(
    (state: number) => {
      const named = STATE_NAMES[state] ?? "unstarted";
      onStateChangeRef.current?.(named);
      if (named === "playing") {
        const p = playerRef.current;
        if (p) {
          const dur = safeNum(p.getDuration());
          liveRef.current = dur === 0;
          void pingView(videoId, safeNum(p.getCurrentTime()));
        }
        if (intervalRef.current === null) {
          intervalRef.current = setInterval(() => {
            const p = playerRef.current;
            if (!p) return;
            const sec = safeNum(p.getCurrentTime());
            const dur = safeNum(p.getDuration());
            onProgressRef.current?.(sec, dur);
            tickCountRef.current += 1;
            if (tickCountRef.current % PERSIST_EVERY_TICKS === 0) savePosition();
          }, PROGRESS_INTERVAL_MS);
        }
      } else if (named === "paused" || named === "buffering") {
        savePosition();
      } else if (named === "ended") {
        stopProgressLoop();
        savePosition();
        onProgressRef.current?.(safeNum(playerRef.current?.getDuration() ?? 0), 0);
        onEndedRef.current?.();
      }
    },
    [savePosition, stopProgressLoop, videoId]
  );

  // mount: load the API, create the player
  useEffect(() => {
    let cancelled = false;
    let created: YTPlayerInstance | null = null;
    const el = containerRef.current;
    if (!el) return;

    void loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled) return;
        created = new YT.Player(el, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: {
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
          },
          events: {
            onReady: () => {
              if (cancelled) return;
              playerRef.current = created;
              const dur = safeNum(created?.getDuration() ?? 0);
              liveRef.current = dur === 0;
              // apply the start position once (resume / ?t=) — never for live
              if (!startAppliedRef.current && startSec && startSec > 0 && !liveRef.current) {
                startAppliedRef.current = true;
                try {
                  created?.seekTo(startSec, true);
                } catch {
                  /* not seekable yet — user can seek */
                }
              }
            },
            onStateChange: (e: { data: number }) => handleState(e.data),
          },
        });
        playerRef.current = created;
      })
      .catch(() => {
        /* the placeholder stays — no crash on offline/blocked embeds */
      });

    return () => {
      cancelled = true;
      stopProgressLoop();
      savePosition();
      try {
        created?.destroy();
      } catch {
        /* already destroyed */
      }
      playerRef.current = null;
    };
  }, []);

  // videoId change: loadVideoById (the iframe keeps playing — no reload)
  useEffect(() => {
    if (playerRef.current && playerRef.current.loadVideoById) {
      startAppliedRef.current = false;
      liveRef.current = false;
      tickCountRef.current = 0;
      playerRef.current.loadVideoById({
        videoId,
        ...(startSec && startSec > 0 ? { startSeconds: startSec } : {}),
      });
      if (startSec && startSec > 0) startAppliedRef.current = true;
    }
  }, [videoId, startSec]);

  // save position on unmount of the video (navigation away)
  useEffect(() => savePosition, [savePosition]);

  useImperativeHandle(
    handleRef,
    () => ({
      play: () => playerRef.current?.playVideo(),
      pause: () => playerRef.current?.pauseVideo(),
      togglePlay: () => {
        const p = playerRef.current;
        if (!p) return;
        const playing = p.getPlayerState?.() === 1;
        if (playing) p.pauseVideo();
        else p.playVideo();
      },
      seekTo: (sec: number) => {
        try {
          playerRef.current?.seekTo(sec, true);
        } catch {
          /* player gone */
        }
      },
      getCurrentTime: () => safeNum(playerRef.current?.getCurrentTime() ?? 0),
      getDuration: () => safeNum(playerRef.current?.getDuration() ?? 0),
    }),
    []
  );

  const isShorts = className?.includes("shorts");

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden bg-black",
        isShorts ? "aspect-[9/16] max-h-[calc(100vh-64px)] max-w-[480px] mx-auto rounded-2xl" : "aspect-video",
        className
      )}
      aria-label="YouTube video player"
      role="region"
    >
      {/* YT.Player replaces this node with the iframe */}
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />
      <noscript>
        <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white">
          The YouTube player needs JavaScript enabled.
        </p>
      </noscript>
    </div>
  );
}

function safeNum(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** Back-compat export shapes: default + named (the Shorts slot contract). */
export default YoutubePlayer;
export { YoutubePlayer as Player };
