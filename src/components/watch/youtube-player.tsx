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

/** Task 2-c — why the embedded player can't play (the fallback chain's trigger). */
export type EmbedBlockedReason =
  /** onError 101/150 — the uploader disabled embedding */
  | "embed-disabled"
  /** other onError codes (100/2/5…) */
  | "player-error"
  /** the iframe API loaded but onReady never fired (~5s) — a dead/walled iframe */
  | "no-ready"
  /** the iframe_api script itself could not be loaded */
  | "api-dead";

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
  mute(): void;
  unMute(): void;
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

/** Persist a resume position under the shared progress key (exported for the native fallback player). */
export function saveProgressMemory(videoId: string, sec: number): void {
  persistProgress(videoId, sec);
}

/** Fire the once-per-session view ping (exported for the native fallback player). */
export function fireViewPing(videoId: string, watchedSec: number): Promise<void> {
  return pingView(videoId, watchedSec);
}

/* ---------- embed health probe (Task 2-c) ---------- */

/**
 * Deterministic embed-wall detector: a tiny OFFSCREEN muted autoplaying player
 * — the "autoplay attempt" of the fallback chain. Muted autoplay is allowed
 * by every browser, so a HEALTHY embed reaches PLAYING(1) quickly (live-probe
 * evidence: ~0.6s on a healthy embed); a walled embed ("Sign in to confirm
 * you're not a bot") never starts playback at all.
 *
 * Verdict:
 *  - true  — PLAYING observed (within `timeoutMs`; a BUFFERING report extends
 *            the deadline once, to 2×, so slow-but-working embeds pass);
 *  - false — onError fired, or the deadline passed with no playback.
 *
 * One probe at a time per videoId (concurrent calls share the promise); a new
 * videoId supersedes an in-flight probe. The probe player is destroyed and
 * its DOM removed on every exit — the main player is never touched.
 */
/** One probe at a time (a new videoId supersedes + aborts an in-flight probe). */
let activeProbe: { videoId: string; promise: Promise<boolean> } | null = null;
let abortActiveProbe: ((healthy: boolean) => void) | null = null;

export function probeEmbedHealth(videoId: string, opts: { timeoutMs?: number } = {}): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (activeProbe?.videoId === videoId) return activeProbe.promise;
  abortActiveProbe?.(false); // supersede: clean up any in-flight probe's player + DOM
  abortActiveProbe = null;

  const timeoutMs = opts.timeoutMs ?? 7_000;
  const promise = new Promise<boolean>((resolve) => {
    let settled = false;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    let probe: YTPlayerInstance | null = null;
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-wfx-embed-probe", videoId);
    wrapper.style.cssText =
      "position:fixed;left:-10000px;top:-10000px;width:160px;height:90px;pointer-events:none;opacity:0;";

    const finish = (healthy: boolean) => {
      if (settled) return;
      settled = true;
      if (abortActiveProbe === finish) abortActiveProbe = null;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      try {
        probe?.destroy();
      } catch {
        /* already destroyed */
      }
      wrapper.remove();
      resolve(healthy);
    };
    abortActiveProbe = finish;

    const armDeadline = (ms: number) => {
      if (deadlineTimer) clearTimeout(deadlineTimer);
      deadlineTimer = setTimeout(() => finish(false), ms);
    };

    void loadYouTubeIframeApi()
      .then((YT) => {
        if (settled) return;
        const host = document.createElement("div");
        wrapper.appendChild(host);
        document.body.appendChild(wrapper);
        probe = new YT.Player(host, {
          videoId,
          width: "160",
          height: "90",
          playerVars: {
            autoplay: 1,
            mute: 1,
            controls: 0,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            fs: 0,
            disablekb: 1,
          },
          events: {
            onReady: () => {
              if (settled) return;
              try {
                probe?.mute();
                probe?.playVideo();
              } catch {
                /* the deadline decides */
              }
              armDeadline(timeoutMs);
            },
            onStateChange: (e: { data: number }) => {
              if (settled) return;
              if (e.data === 1) finish(true); // PLAYING — the only health proof
              else if (e.data === 3) armDeadline(timeoutMs * 2); // buffering: extend once
            },
            onError: () => finish(false),
          },
        });
        // belt-and-braces: onReady may never come (a dead iframe)
        armDeadline(timeoutMs);
      })
      .catch(() => finish(false)); // iframe_api dead → no embed can play
  });

  const tracked = promise.finally(() => {
    if (abortActiveProbe === null && activeProbe?.promise === tracked) activeProbe = null;
  });
  activeProbe = { videoId, promise: tracked };
  return tracked;
}

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
  /** Task 2-c — fires ONCE per videoId when the embed cannot play (the fallback chain's trigger). */
  onBlocked?: (reason: EmbedBlockedReason) => void;
}

export function YoutubePlayer({
  videoId,
  startSec,
  onProgress,
  onEnded,
  onStateChange,
  className,
  handleRef,
  onBlocked,
}: YoutubePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickCountRef = useRef(0);
  const startAppliedRef = useRef(false);
  const liveRef = useRef(false);
  const readyRef = useRef(false);
  const blockedFiredRef = useRef(false);

  // stable callbacks (the player events live across renders)
  const onProgressRef = useRef(onProgress);
  const onEndedRef = useRef(onEnded);
  const onStateChangeRef = useRef(onStateChange);
  const onBlockedRef = useRef(onBlocked);
  useEffect(() => {
    onProgressRef.current = onProgress;
    onEndedRef.current = onEnded;
    onStateChangeRef.current = onStateChange;
    onBlockedRef.current = onBlocked;
  });

  /** Task 2-c — report the embed as blocked (once per mount/videoId). */
  const reportBlocked = useCallback(
    (reason: EmbedBlockedReason) => {
      if (blockedFiredRef.current) return;
      blockedFiredRef.current = true;
      onBlockedRef.current?.(reason);
    },
    []
  );

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
    let noReadyTimer: ReturnType<typeof setTimeout> | null = null;
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
              readyRef.current = true;
              if (noReadyTimer) {
                clearTimeout(noReadyTimer);
                noReadyTimer = null;
              }
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
            // Task 2-c — 101/150 = embedding disallowed; 100/2/5 = the video
            // itself is broken. Either way the embed cannot play → blocked.
            onError: (e: { data: number }) => {
              if (cancelled) return;
              reportBlocked(e.data === 101 || e.data === 150 ? "embed-disabled" : "player-error");
            },
          },
        });
        playerRef.current = created;
        // Task 2-c — a loaded iframe API whose onReady never arrives (~5s)
        // is a dead/walled embed (the wall never initializes the player).
        noReadyTimer = setTimeout(() => {
          if (!cancelled && !readyRef.current) reportBlocked("no-ready");
        }, 5_000);
      })
      .catch(() => {
        /* the placeholder stays — no crash on offline/blocked embeds */
        if (!cancelled) reportBlocked("api-dead");
      });

    return () => {
      cancelled = true;
      if (noReadyTimer) clearTimeout(noReadyTimer);
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
      blockedFiredRef.current = false; // a new video gets a fresh blocked verdict
      readyRef.current = false;
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
