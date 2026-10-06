"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PlayCircle, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadYouTubeIframeApi } from "@/components/watch/youtube-player";
import {
  fetchPlayback,
  pickStoryboardLevel,
  storyboardSheetUrl,
} from "@/lib/watch/playback-client";
import type { StoryboardLevelDto } from "@/lib/watch/types";

/**
 * YouTube-style hover preview (WFX2-P6-HP → P12-UX Task 4: the mini player).
 *
 * ONE shared layer follows the hovered card (fixed, over the thumbnail)
 * after a 600ms dwell — exactly what youtube.com's home grid does on hover.
 *
 * P12-UX Task 4: each card now behaves like a MINI VIDEO PLAYER. On fine
 * pointers the dwell crossfades the thumbnail into a MUTED AUTOPLAYING
 * YouTube iframe embed (the same IFrame API the watch player uses — the
 * watch page's embed renders fine in end-user browsers, so a muted hover
 * embed is viable client-side). If the embed does not report PLAYING or
 * BUFFERING within EMBED_HEALTH_MS (~1.5s — the bot-wall / dead-iframe
 * signature), it is destroyed and the STORYBOARD animation from WFX2-P6-HP
 * takes over (kept as the fallback, never deleted): sprite sheets from
 * /api/videos/[id]/playback animated Invidious-style, ken-burns degrade
 * when no storyboard exists.
 *
 * Device policy (youtube.com parity):
 *  - touch / coarse pointers: NO preview at all (hover doesn't exist);
 *  - prefers-reduced-motion: storyboard-only (no embed; the ken-burns
 *    degrade is disabled in CSS for these users too);
 *  - shorts shelf tiles carry [data-no-preview] and never preview —
 *    youtube.com's shorts tiles only scale on hover, no video preview.
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
};

type PreviewStore = {
  snapshot: PreviewSnapshot;
  listeners: Set<() => void>;
  show: (video: PreviewVideo, anchor: HTMLElement, mode?: PreviewMode) => void;
  hide: () => void;
};

const globalRef = globalThis as unknown as { __wfxPreviewStore?: PreviewStore };
const store: PreviewStore =
  globalRef.__wfxPreviewStore ??
  (globalRef.__wfxPreviewStore = {
    // ONE stable snapshot object per state (React's useSyncExternalStore
    // requires getSnapshot to return a cached reference).
    snapshot: { video: null, rect: null, mode: "storyboard" },
    listeners: new Set(),
    show(video, anchor, mode = "storyboard") {
      store.snapshot = { video, rect: anchor.getBoundingClientRect(), mode };
      for (const listener of store.listeners) listener();
    },
    hide() {
      if (!store.snapshot.video) return;
      store.snapshot = { video: null, rect: null, mode: "storyboard" };
      for (const listener of store.listeners) listener();
    },
  });

const DWELL_MS = 600;

/**
 * P12-UX — how long the muted embed gets to reach PLAYING/BUFFERING before
 * the preview falls back to the storyboard animation (the watch player's
 * probe allows 7s; a hover preview must be snappy — ~1.5s like the
 * operator-visible youtube.com behavior).
 */
export const EMBED_HEALTH_MS = 1500;

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

/** Hover handlers for VideoCard (dwell-delayed preview start). */
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
      // [data-no-preview] surfaces (the shorts shelf) never preview —
      // youtube.com's shorts tiles only scale on hover.
      if (e.currentTarget.closest?.("[data-no-preview]")) return;
      const anchor = e.currentTarget.querySelector<HTMLElement>("[data-thumb-anchor]");
      if (!anchor) return;
      const v = current.current;
      timer.current = setTimeout(() => {
        // The preview keys on the YouTube video id (it IS the id).
        if (!v.id) return;
        const mode = previewModeForDevice();
        if (!mode) return; // touch device — no hover preview, like youtube.com
        store.show(v, anchor, mode);
      }, DWELL_MS);
    },
    onMouseLeave: () => {
      if (timer.current) clearTimeout(timer.current);
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

const EMPTY_SNAPSHOT: PreviewSnapshot = { video: null, rect: null, mode: "storyboard" };

/**
 * Hidden park: offscreen at a stable nonzero size so the layer never
 * collapses while it is not showing.
 */
const PARKED_STYLE = { left: -10000, top: -10000, width: 320, height: 180 };

type Phase = "loading" | "embed" | "storyboard" | "degraded";

/** The minimal embed surface the preview layer needs. */
type PreviewEmbedPlayer = {
  destroy(): void;
  getPlayerState(): number;
};

/** The single shared preview layer (rendered once in the app shell). */
export function VideoHoverPreviewLayer() {
  const { video, rect, mode } = usePreviewSnapshot();
  // state for the CURRENTLY shown video only (reset per show)
  const [level, setLevel] = useState<StoryboardLevelDto | null>(null);
  const [fetchDone, setFetchDone] = useState(false);
  const [frame, setFrame] = useState(0);
  const [embedDead, setEmbedDead] = useState(false);
  const [embedPlaying, setEmbedPlaying] = useState(false);
  const embedMountRef = useRef<HTMLDivElement>(null);

  const shownId = video?.id ?? null;
  const embedLane = mode === "embed" && !embedDead;

  // Reset the animation when the shown video changes — the sanctioned
  // adjust-during-render pattern (setState synchronously in an effect body
  // is the cascading-render anti-pattern the linter rightly rejects).
  const [resetFor, setResetFor] = useState<string | null>(shownId);
  if (resetFor !== shownId) {
    setResetFor(shownId);
    setLevel(null);
    setFetchDone(false);
    setFrame(0);
    setEmbedDead(false);
    setEmbedPlaying(false);
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
  // stable). No playback within EMBED_HEALTH_MS → destroy + fall back to
  // the storyboard lane (never a walled iframe).
  useEffect(() => {
    if (shownId === null || mode !== "embed") return;
    const mount = embedMountRef.current;
    if (!mount) return;
    let cancelled = false;
    let healthTimer: ReturnType<typeof setTimeout> | null = null;
    let embed: PreviewEmbedPlayer | null = null;
    const host = document.createElement("div");
    host.className = "absolute inset-0 h-full w-full";
    mount.appendChild(host);

    const giveUp = () => {
      if (cancelled) return;
      cancelled = true;
      if (healthTimer) {
        clearTimeout(healthTimer);
        healthTimer = null;
      }
      try {
        embed?.destroy();
      } catch {
        /* already destroyed */
      }
      setEmbedDead(true);
      setEmbedPlaying(false);
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
            controls: 0,
            rel: 0,
            modestbranding: 1,
            playsinline: 1,
            iv_load_policy: 3,
            fs: 0,
            disablekb: 1,
          },
          events: {
            onStateChange: (e: { data: number }) => {
              if (cancelled) return;
              if (e.data === 1 || e.data === 3) {
                // PLAYING/BUFFERING — the embed is healthy; stop the clock.
                if (healthTimer) {
                  clearTimeout(healthTimer);
                  healthTimer = null;
                }
                setEmbedPlaying(true);
              }
            },
            onError: () => giveUp(),
          },
        });
        // The health gate: no PLAYING/BUFFERING in time → storyboard lane.
        healthTimer = setTimeout(() => {
          let state = -1;
          try {
            state = embed?.getPlayerState() ?? -1;
          } catch {
            state = -1;
          }
          if (state !== 1 && state !== 3) giveUp();
        }, EMBED_HEALTH_MS);
      })
      .catch(() => giveUp()); // iframe_api dead → no embed can play

    return () => {
      cancelled = true;
      if (healthTimer) clearTimeout(healthTimer);
      try {
        embed?.destroy();
      } catch {
        /* already destroyed */
      }
      host.remove();
    };
  }, [shownId, mode]);

  // The effective phase: the embed lane owns the card while alive; once
  // dead (or in storyboard mode) the storyboard/degrade takes over.
  const phase: Phase = embedLane
    ? embedPlaying
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

  return (
    <div
      aria-hidden="true"
      data-hover-preview-layer=""
      data-testid={visible ? "hover-preview" : undefined}
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
          {/* P12-UX Task 4 — the mini player: a muted autoplaying embed,
              crossfaded in over the thumbnail once it reports playback. It
              occupies this layer — the card's own thumbnail rect — so the
              preview can never shift layout. */}
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
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
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
          {/* P12-UX — the muted-audio indicator (like youtube.com's preview) */}
          {phase === "embed" && (
            <span
              data-testid="hover-preview-muted"
              className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium text-white"
            >
              <VolumeX className="size-3" aria-hidden="true" /> Muted
            </span>
          )}
          <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
            <PlayCircle className="size-3" aria-hidden="true" /> Preview
          </span>
        </div>
      ) : null}
    </div>
  );
}
