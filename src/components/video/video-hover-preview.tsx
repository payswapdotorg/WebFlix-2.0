"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PlayCircle, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadYouTubeIframeApi } from "@/components/watch/youtube-player";
import { formatDuration } from "@/lib/format";
import {
  fetchPlayback,
  pickStoryboardLevel,
  storyboardSheetUrl,
} from "@/lib/watch/playback-client";
import type { StoryboardLevelDto } from "@/lib/watch/types";

/**
 * YouTube-style hover preview (WFX2-P6-HP → P12-UX Task 4 → P22-A: the mini
 * player that PLAYS).
 *
 * ONE shared layer follows the hovered card (fixed, over the thumbnail)
 * after a 600ms dwell — exactly what youtube.com's home grid does on hover.
 *
 * P22-A: each hovered card is a MINI VIDEO PLAYER with youtube.com's preview
 * chrome — a SCRUBBABLE TIMELINE and a MUTE/UNMUTE button over the muted
 * autoplaying YouTube iframe embed (the same IFrame API the watch player
 * uses). The health gate was the P12 bug the operator reported: a flat
 * 1.5s-from-construction deadline destroyed healthy-but-slow embeds (a
 * first-hover iframe legitimately needs 1-2.5s: API script → iframe boot →
 * first buffer), so the preview almost always degraded to the storyboard
 * and — when no storyboard exists — to the ken-burns zoom. The honest
 * ladder the P22 gate keeps:
 *
 *  - the embed gets a FAIR window (the watch player's own laws): onReady
 *    must arrive within EMBED_NO_READY_MS (~5s — a loaded iframe API whose
 *    onReady never arrives is a dead/walled iframe), then PLAYING/BUFFERING
 *    within EMBED_PLAYING_MS (~4s from ready), with a BUFFERING report
 *    extending that deadline once to 2× (the probeEmbedHealth pattern —
 *    slow-but-working embeds pass; only hard onError or a truly silent
 *    iframe falls back);
 *  - onReady also belt-and-braces mutes + plays (the probe's pattern);
 *  - the STORYBOARD animation (WFX2-P6-HP) stays the fallback — sprite
 *    sheets from /api/videos/[id]/playback animated Invidious-style;
 *  - ken-burns remains the LAST resort (embed dead AND no storyboard),
 *    never the common case.
 *
 * P22-A controls: youtube.com's home-grid hover preview carries a slim
 * progress/seek bar along the bottom edge and a circular mute toggle in the
 * corner. Ours ride the same geometry; the layer itself stays
 * pointer-events-none (clicks everywhere else pass through to the card's
 * watch link — youtube.com's preview is clickable the same way), only the
 * controls take pointer events. Riding the controls must not close the
 * preview: the card's mouseleave ignores exits whose relatedTarget is
 * inside this layer, and the controls' mouseleave ignores exits onto the
 * hovered card (the store carries the card element for exactly that).
 *
 * Device policy (youtube.com parity):
 *  - touch / coarse pointers: NO preview at all (hover doesn't exist);
 *  - prefers-reduced-motion: storyboard-only (no embed; the ken-burns
 *    degrade is disabled in CSS for these users too);
 *  - P22-A: shorts tiles PREVIEW ON HOVER like youtube.com (it plays
 *    shorts on hover now — muted autoplay); the old [data-no-preview]
 *    shorts opt-out is gone.
 *
 * The store lives on globalThis so the layer (rendered from the app shell)
 * and the cards (page tree) always share ONE instance, even if the bundler
 * splits the module across chunk graphs. Never more than ONE preview
 * player exists: a new show destroys the previous embed first, and hide
 * destroys it on the way out.
 */
type PreviewVideo = { id: string; title: string; thumbnailUrl?: string | null };

/** How the preview plays this video. */
type PreviewMode = "embed" | "storyboard";

type PreviewSnapshot = {
  video: PreviewVideo | null;
  rect: DOMRect | null;
  mode: PreviewMode;
  /**
   * The hovered CARD element (the article/Link that carries the hover
   * handlers). The controls' mouseleave needs it to tell "pointer moved
   * back onto the card" (keep the preview) from "pointer left for good"
   * (hide) — the fixed layer is NOT a DOM child of the card, so the card's
   * own leave/enter pair cannot express it alone.
   */
  card: HTMLElement | null;
};

type PreviewStore = {
  snapshot: PreviewSnapshot;
  listeners: Set<() => void>;
  show: (
    video: PreviewVideo,
    card: HTMLElement,
    anchor: HTMLElement,
    mode?: PreviewMode
  ) => void;
  hide: () => void;
};

const globalRef = globalThis as unknown as { __wfxPreviewStore?: PreviewStore };
const store: PreviewStore =
  globalRef.__wfxPreviewStore ??
  (globalRef.__wfxPreviewStore = {
    // ONE stable snapshot object per state (React's useSyncExternalStore
    // requires getSnapshot to return a cached reference).
    snapshot: { video: null, rect: null, mode: "storyboard", card: null },
    listeners: new Set(),
    show(video, card, anchor, mode = "storyboard") {
      store.snapshot = { video, rect: anchor.getBoundingClientRect(), mode, card };
      for (const listener of store.listeners) listener();
    },
    hide() {
      if (!store.snapshot.video) return;
      store.snapshot = { video: null, rect: null, mode: "storyboard", card: null };
      for (const listener of store.listeners) listener();
    },
  });

const DWELL_MS = 600;

/**
 * P22-A — how long the embed gets for its IFrame to come ready. The watch
 * player's own no-ready law (youtube-player.tsx): "a loaded iframe API
 * whose onReady never arrives (~5s) is a dead/walled embed" — the wall
 * never initializes the player. Replaces P12's flat 1.5s-from-construction
 * deadline, which killed healthy first-hover embeds mid-boot.
 */
export const EMBED_NO_READY_MS = 5000;

/**
 * P22-A — how long after onReady the embed has to report playback
 * (PLAYING/ENDED, or BUFFERING while it keeps working). A BUFFERING report
 * extends this deadline once, to 2× (probeEmbedHealth's semantics). The
 * watch player's probe allows 7s from scratch with the same extension; a
 * hover preview crossfades in the moment playback starts, so a generous
 * window is invisible to the user — the storyboard keeps them company.
 */
export const EMBED_PLAYING_MS = 4000;

/**
 * The hover mode for the current device — null means NO preview at all
 * (touch). Reduced-motion users get the storyboard lane only.
 */
function previewModeForDevice(): PreviewMode | null {
  if (typeof window === "undefined") return "storyboard";
  try {
    if (typeof window.matchMedia === "function") {
      if (window.matchMedia("(pointer: coarse)").matches) return null;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "storyboard";
    }
  } catch {
    /* unmatchable — fall through to the embed lane */
  }
  return "embed";
}

/**
 * Frame display cadence: storyboards typically carry a frame every ~1-2s of
 * video (real-time pace feels static on a hover) — cycle at a lively but
 * honest-feeling 1 frame/second, clamped for exotic intervals.
 */
function frameTickMs(level: StoryboardLevelDto): number {
  return Math.max(400, Math.min(1000, level.intervalMs || 1000));
}

/** The preview layer element (unique — rendered once in the app shell). */
function previewLayerEl(): Element | null {
  if (typeof document === "undefined") return null;
  return document.querySelector("[data-hover-preview-layer]");
}

/** Is this event target inside the shared preview layer? (the controls' home) */
function nodeInPreviewLayer(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Node)) return false;
  const layer = previewLayerEl();
  return !!layer && layer.contains(target);
}

/** Hover handlers for video cards (dwell-delayed preview start). */
export function useHoverPreview(video: PreviewVideo) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useRef(video);

  useEffect(() => {
    current.current = video;
  }, [video]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      const anchor = e.currentTarget.querySelector<HTMLElement>("[data-thumb-anchor]");
      if (!anchor) return;
      const card = e.currentTarget;
      const v = current.current;
      timer.current = setTimeout(() => {
        // The preview keys on the YouTube video id (it IS the id).
        if (!v.id) return;
        const mode = previewModeForDevice();
        if (!mode) return; // touch device — no hover preview, like youtube.com
        store.show(v, card, anchor, mode);
      }, DWELL_MS);
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      if (timer.current) clearTimeout(timer.current);
      // P22-A: leaving the card ONTO the preview's own controls (the layer
      // is a fixed sibling, not a card child) must NOT close the preview —
      // youtube.com keeps the mini player alive while you ride its
      // timeline/mute. Everything else closes it.
      if (nodeInPreviewLayer(e.nativeEvent.relatedTarget)) return;
      store.hide();
    },
  };
}

/** Subscribe the layer to the shared preview state. */
function usePreviewSnapshot(): PreviewSnapshot {
  return useSyncExternalStore(
    (listener) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    () => store.snapshot,
    () => EMPTY_SNAPSHOT
  );
}

const EMPTY_SNAPSHOT: PreviewSnapshot = {
  video: null,
  rect: null,
  mode: "storyboard",
  card: null,
};

/**
 * Hidden park: offscreen at a stable nonzero size so the layer never
 * collapses while it is not showing.
 */
const PARKED_STYLE = { left: -10000, top: -10000, width: 320, height: 180 };

type Phase = "loading" | "embed" | "storyboard" | "degraded";

/**
 * The minimal embed surface the preview player + its controls need (the
 * YT.Player contract the watch player already types).
 */
type PreviewEmbedPlayer = {
  destroy(): void;
  getPlayerState(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  playVideo(): void;
};

function safeNum(n: number | undefined | null): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** The single shared preview layer (rendered once in the app shell). */
export function VideoHoverPreviewLayer() {
  const { video, rect, mode, card } = usePreviewSnapshot();
  // state for the CURRENTLY shown video only (reset per show)
  const [level, setLevel] = useState<StoryboardLevelDto | null>(null);
  const [fetchDone, setFetchDone] = useState(false);
  const [frame, setFrame] = useState(0);
  const [embedDead, setEmbedDead] = useState(false);
  const [embedAlive, setEmbedAlive] = useState(false);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState<{ time: number; duration: number }>({
    time: 0,
    duration: 0,
  });
  const [scrubFrac, setScrubFrac] = useState<number | null>(null);
  const embedMountRef = useRef<HTMLDivElement>(null);
  const embedRef = useRef<PreviewEmbedPlayer | null>(null);
  const draggingRef = useRef(false);

  const shownId = video?.id ?? null;
  const embedLane = mode === "embed" && !embedDead;

  // Reset the animation + controls when the shown video changes — the
  // sanctioned adjust-during-render pattern (setState synchronously in an
  // effect body is the cascading-render anti-pattern the linter rightly
  // rejects).
  const [resetFor, setResetFor] = useState<string | null>(shownId);
  if (resetFor !== shownId) {
    setResetFor(shownId);
    setLevel(null);
    setFetchDone(false);
    setFrame(0);
    setEmbedDead(false);
    setEmbedAlive(false);
    setMuted(true);
    setProgress({ time: 0, duration: 0 });
    setScrubFrac(null);
  }

  // Hide when the page scrolls (the anchor rect would go stale).
  useEffect(() => {
    if (!video) return;
    const onScroll = () => store.hide();
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [video]);

  // Per shown video: fetch the storyboard (client-cached by fetchPlayback —
  // one request per video per session). The storyboard is the PRIMARY lane
  // in storyboard mode (reduced motion) and the FALLBACK data for the embed
  // lane — one fetch serves both.
  useEffect(() => {
    if (shownId === null) return;
    let alive = true;
    void fetchPlayback(shownId).then((playback) => {
      if (!alive) return;
      setLevel(playback ? pickStoryboardLevel(playback.storyboards) : null);
      setFetchDone(true);
    });
    return () => {
      alive = false;
    };
  }, [shownId]);

  // The embed lane: ONE muted autoplaying player per shown video, created
  // inside an imperative host (the probeEmbedHealth pattern — YT.Player
  // replaces the host with an iframe, so the React-owned mount stays
  // stable). The P22-A health gate (honest ladder — never a walled iframe,
  // never a murdered healthy one):
  //   - onReady within EMBED_NO_READY_MS, else give up (dead iframe);
  //   - onReady → belt-and-braces mute + play, then a EMBED_PLAYING_MS
  //     window for playback, extended ONCE to 2× by a BUFFERING report;
  //   - onError → give up immediately (101/150 embed-disabled included);
  //   - PLAYING/ENDED → healthy, the deadline clocks stop for good.
  useEffect(() => {
    if (shownId === null || mode !== "embed") return;
    const mount = embedMountRef.current;
    if (!mount) return;
    // a fresh embed means a fresh scrub (an interrupted drag must not leak
    // into the next preview's pointermove — refs only move inside effects)
    draggingRef.current = false;
    let cancelled = false;
    let noReadyTimer: ReturnType<typeof setTimeout> | null = null;
    let playingTimer: ReturnType<typeof setTimeout> | null = null;
    let extended = false; // BUFFERING extends the playing deadline once
    let embed: PreviewEmbedPlayer | null = null;
    const host = document.createElement("div");
    host.className = "absolute inset-0 h-full w-full";
    mount.appendChild(host);

    const clearTimers = () => {
      if (noReadyTimer) {
        clearTimeout(noReadyTimer);
        noReadyTimer = null;
      }
      if (playingTimer) {
        clearTimeout(playingTimer);
        playingTimer = null;
      }
    };

    const giveUp = () => {
      if (cancelled) return;
      cancelled = true;
      clearTimers();
      try {
        embed?.destroy();
      } catch {
        /* already destroyed */
      }
      if (embedRef.current === embed) embedRef.current = null;
      host.remove();
      setEmbedDead(true);
      setEmbedAlive(false);
    };

    const armPlaying = (ms: number) => {
      if (playingTimer) clearTimeout(playingTimer);
      playingTimer = setTimeout(() => {
        // Belt-and-braces: the state may have advanced without the event
        // landing yet — ask the player itself before giving up.
        let state = -1;
        try {
          state = embed?.getPlayerState() ?? -1;
        } catch {
          state = -1;
        }
        if (state === 1 || state === 3 || state === 0) {
          clearTimers();
          setEmbedAlive(true);
        } else giveUp();
      }, ms);
    };

    void loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled) return;
        embed = new YT.Player(host, {
          videoId: shownId,
          width: "100%",
          height: "100%",
          playerVars: {
            autoplay: 1,
            mute: 1,
            // youtube.com's preview chrome is its own slim timeline + mute
            // toggle (see the controls below) — the full ytp chrome would
            // dwarf a 320px card. The controls live in OUR layer.
            controls: 0,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            iv_load_policy: 3,
            fs: 0,
            disablekb: 1,
          },
          events: {
            onReady: () => {
              if (cancelled) return;
              // The watch player's own belt-and-braces: muted autoplay is
              // the policy every browser allows — ask for it explicitly.
              try {
                embed?.mute();
                embed?.playVideo();
              } catch {
                /* the deadline decides */
              }
              if (noReadyTimer) {
                clearTimeout(noReadyTimer);
                noReadyTimer = null;
              }
              armPlaying(EMBED_PLAYING_MS);
            },
            onStateChange: (e: { data: number }) => {
              if (cancelled) return;
              if (e.data === 1 || e.data === 0) {
                // PLAYING / ENDED — sustained playback proof. The clocks stop.
                clearTimers();
                setEmbedAlive(true);
              } else if (e.data === 3) {
                // BUFFERING — the embed is alive (the wall never buffers);
                // crossfade it in, and give a slow-but-working player one
                // deadline extension (the probe's semantics).
                setEmbedAlive(true);
                if (!extended) {
                  extended = true;
                  armPlaying(EMBED_PLAYING_MS * 2);
                }
              }
            },
            onError: () => giveUp(),
          },
        });
        embedRef.current = embed;
        // The no-ready law: a loaded iframe API whose onReady never arrives
        // is a dead/walled iframe (the watch player's ~5s precedent).
        noReadyTimer = setTimeout(() => {
          if (!cancelled) giveUp();
        }, EMBED_NO_READY_MS);
      })
      .catch(() => giveUp()); // iframe_api dead → no embed can play

    return () => {
      cancelled = true;
      clearTimers();
      try {
        embed?.destroy();
      } catch {
        /* already destroyed */
      }
      if (embedRef.current === embed) embedRef.current = null;
      host.remove();
    };
  }, [shownId, mode]);

  // The effective phase: the embed lane owns the card while alive; once
  // dead (or in storyboard mode) the storyboard/degrade takes over.
  const phase: Phase = embedLane
    ? embedAlive
      ? "embed"
      : "loading"
    : level
      ? "storyboard"
      : fetchDone
        ? "degraded"
        : "loading";

  // The animation clock: advance the frame cursor while shown + storyboard.
  useEffect(() => {
    if (phase !== "storyboard" || !level || shownId === null) return;
    const tick = frameTickMs(level);
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % Math.max(1, level.frameCount));
    }, tick);
    return () => clearInterval(timer);
  }, [phase, level, shownId]);

  // P22-A — the timeline's heartbeat: poll the live player ~4Hz while the
  // embed owns the card (the watch player's progress loop, preview-sized).
  useEffect(() => {
    if (phase !== "embed" || shownId === null) return;
    const poll = setInterval(() => {
      const p = embedRef.current;
      if (!p) return;
      try {
        const next = { time: safeNum(p.getCurrentTime()), duration: safeNum(p.getDuration()) };
        setProgress(next);
        setMuted(() => {
          try {
            return p.isMuted();
          } catch {
            return true;
          }
        });
      } catch {
        /* player gone — the phase change will stop the poll */
      }
    }, 250);
    return () => clearInterval(poll);
  }, [phase, shownId]);

  const visible = !!video && !!rect;

  // storyboard geometry for the current frame (sheet/col/row)
  const geom = (() => {
    if (!level || phase !== "storyboard") return null;
    const perSheet = level.cols * level.rows;
    const clamped = Math.min(frame, Math.max(0, level.frameCount - 1));
    const sheet = Math.floor(clamped / perSheet);
    const inSheet = clamped % perSheet;
    const col = inSheet % level.cols;
    const row = Math.floor(inSheet / level.cols);
    return {
      sheetUrl: storyboardSheetUrl(level.templateUrl, sheet),
      backgroundSize: `${level.cols * level.frameWidth}px ${level.rows * level.frameHeight}px`,
      backgroundPosition: `${-col * level.frameWidth}px ${-row * level.frameHeight}px`,
    };
  })();

  /* ---- P22-A: the preview chrome (youtube.com's home-grid hover) ---- */

  /** Leave a control: keep the preview while the pointer rides this layer's
   * controls or returns to the hovered card; everything else hides it. */
  const onControlsLeave = (e: React.MouseEvent) => {
    const to = e.nativeEvent.relatedTarget;
    if (nodeInPreviewLayer(to)) return;
    if (to instanceof Node && card?.contains(to)) return;
    store.hide();
  };
  const toggleMute = () => {
    const p = embedRef.current;
    if (!p) return;
    try {
      if (p.isMuted()) {
        p.unMute();
        setMuted(false);
      } else {
        p.mute();
        setMuted(true);
      }
    } catch {
      /* player gone */
    }
  };

  const seekToFraction = (frac: number) => {
    const clamped = Math.min(1, Math.max(0, frac));
    setScrubFrac(clamped); // the bar follows the pointer immediately
    const p = embedRef.current;
    if (!p) return;
    const dur = safeNum(p.getDuration());
    if (dur > 0) {
      try {
        p.seekTo(clamped * dur, true);
      } catch {
        /* player gone */
      }
    }
  };

  const fracFromPointer = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return r.width > 0 ? (e.clientX - r.left) / r.width : 0;
  };

  const shownFrac =
    scrubFrac ??
    (progress.duration > 0 ? Math.min(1, progress.time / progress.duration) : 0);

  return (
    <div
      data-hover-preview-layer=""
      data-testid={visible ? "hover-preview" : undefined}
      aria-label="Video preview"
      className={cn(
        "pointer-events-none fixed z-30 overflow-hidden rounded-xl border border-border/40 bg-black shadow-2xl",
        !visible && "invisible"
      )}
      style={
        rect
          ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          : PARKED_STYLE
      }
    >
      {video ? (
        <div className="relative h-full w-full bg-black" data-preview-phase={phase}>
          {/* the thumbnail base: ken-burns while loading/degraded; static
              backdrop under the storyboard frames (a failed sheet load
              degrades to this — never a broken box) */}
          {video.thumbnailUrl ? (
            <img
              src={video.thumbnailUrl}
              alt=""
              className={cn(
                "absolute inset-0 h-full w-full object-cover",
                (phase === "loading" || phase === "degraded") && "wfx-kenburns"
              )}
            />
          ) : null}
          {/* the mini player: a muted autoplaying embed, crossfaded in over
              the thumbnail once it reports playback. It occupies this layer
              — the card's own thumbnail rect — so the preview can never
              shift layout. */}
          {embedLane && (
            <div
              ref={embedMountRef}
              data-testid="hover-preview-embed"
              className={cn(
                "absolute inset-0 h-full w-full bg-black transition-opacity duration-300",
                phase === "embed" ? "opacity-100" : "opacity-0"
              )}
            />
          )}
          {phase === "loading" ? (
            <div
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center bg-black/30"
            >
              <span className="size-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            </div>
          ) : null}
          {geom ? (
            <div
              data-testid="storyboard-frame"
              className="absolute inset-0 transition-opacity duration-300"
              style={{
                backgroundImage: `url("${geom.sheetUrl}")`,
                backgroundSize: geom.backgroundSize,
                backgroundPosition: geom.backgroundPosition,
                backgroundRepeat: "no-repeat",
                imageRendering: "auto",
              }}
            />
          ) : null}
          {phase === "embed" ? (
            <>
              {/* the pill — youtube.com's own "Preview" label, decorative */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute bottom-3 left-2 flex items-center gap-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium text-white"
              >
                <PlayCircle className="size-3" aria-hidden="true" /> Preview
              </span>
              {/* the mute toggle — youtube.com's circular corner button */}
              <button
                type="button"
                data-testid="hover-preview-mute"
                aria-label={muted ? "Unmute preview" : "Mute preview"}
                onClick={toggleMute}
                onMouseLeave={onControlsLeave}
                className="pointer-events-auto absolute bottom-3 right-2 flex size-8 items-center justify-center rounded-full bg-black/80 text-white transition-colors hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
              >
                {muted ? (
                  <VolumeX className="size-4" aria-hidden="true" />
                ) : (
                  <Volume2 className="size-4" aria-hidden="true" />
                )}
              </button>
              {/* the timeline — youtube.com's slim bottom seek bar (scrub by
                  pointer, step by keyboard — a real slider, not a picture
                  of one) */}
              <div
                data-testid="hover-preview-seek"
                role="slider"
                tabIndex={0}
                aria-label="Seek preview"
                aria-valuemin={0}
                aria-valuemax={Math.max(0, Math.round(progress.duration))}
                aria-valuenow={Math.min(
                  Math.max(0, Math.round(progress.time)),
                  Math.max(0, Math.round(progress.duration))
                )}
                aria-valuetext={
                  progress.duration > 0
                    ? `${formatDuration(progress.time)} of ${formatDuration(progress.duration)}`
                    : "Loading"
                }
                onPointerDown={(e) => {
                  draggingRef.current = true;
                  // capture is best-effort (it throws for non-active
                  // pointers, e.g. synthetic events): without it the drag
                  // still tracks while the pointer rides the bar.
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    /* capture unavailable — the bar-local drag still works */
                  }
                  seekToFraction(fracFromPointer(e));
                }}
                onPointerMove={(e) => {
                  if (draggingRef.current) seekToFraction(fracFromPointer(e));
                }}
                onPointerUp={(e) => {
                  draggingRef.current = false;
                  setScrubFrac(null);
                  try {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  } catch {
                    /* capture already lost */
                  }
                }}
                onKeyDown={(e) => {
                  const p = embedRef.current;
                  const dur = p ? safeNum(p.getDuration()) : 0;
                  if (dur <= 0) return;
                  const step = e.key === "Home" || e.key === "End" ? 0 : 5;
                  let next: number | null = null;
                  if (e.key === "ArrowRight") next = progress.time + step;
                  else if (e.key === "ArrowLeft") next = progress.time - step;
                  else if (e.key === "Home") next = 0;
                  else if (e.key === "End") next = dur;
                  if (next === null) return;
                  e.preventDefault();
                  next = Math.min(dur, Math.max(0, next));
                  try {
                    p?.seekTo(next, true);
                  } catch {
                    /* player gone */
                  }
                  setProgress((prev) => ({ ...prev, time: next }));
                }}
                onMouseLeave={onControlsLeave}
                className="group/seek pointer-events-auto absolute inset-x-0 bottom-0 z-10 flex h-4 cursor-pointer touch-none items-end focus-visible:outline-none"
              >
                <div className="relative h-1 w-full bg-white/30 transition-[height] group-hover/seek:h-1.5">
                  <div
                    data-testid="hover-preview-seek-fill"
                    className="absolute inset-y-0 left-0 bg-yt-red"
                    style={{ width: `${shownFrac * 100}%` }}
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
