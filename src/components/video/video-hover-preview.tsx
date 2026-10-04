"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fetchPlayback,
  pickStoryboardLevel,
  storyboardSheetUrl,
} from "@/lib/watch/playback-client";
import type { StoryboardLevelDto } from "@/lib/watch/types";

/**
 * YouTube-style hover preview (WFX2-P6-HP, rebuilt Task 2-c).
 *
 * ONE shared layer follows the hovered card (fixed, over the thumbnail)
 * after a 600ms dwell — exactly what youtube.com's home grid does on hover.
 *
 * Task 2-c: the preview NEVER touches YouTube iframe embeds (they show the
 * "Sign in to confirm you're not a bot" wall for third-party contexts).
 * Instead, after the dwell the layer fetches the video's storyboard
 * (/api/videos/[id]/playback → server-side player-response chain) and
 * ANIMATES it Invidious-style: sprite sheets are lazy-loaded as the frame
 * cursor advances (one background-image per sheet — the browser fetches
 * each sheet the first time it paints). No storyboard available (walled
 * egress) → a subtle zoom/pan on the thumbnail (never a broken iframe).
 *
 * The store lives on globalThis so the layer (rendered from the app shell)
 * and the cards (page tree) always share ONE instance, even if the bundler
 * splits the module across chunk graphs.
 */
type PreviewVideo = { id: string; title: string; thumbnailUrl?: string | null };

type PreviewSnapshot = {
  video: PreviewVideo | null;
  rect: DOMRect | null;
};

type PreviewStore = {
  snapshot: PreviewSnapshot;
  listeners: Set<() => void>;
  show: (video: PreviewVideo, anchor: HTMLElement) => void;
  hide: () => void;
};

const globalRef = globalThis as unknown as { __wfxPreviewStore?: PreviewStore };
const store: PreviewStore =
  globalRef.__wfxPreviewStore ??
  (globalRef.__wfxPreviewStore = {
    // ONE stable snapshot object per state (React's useSyncExternalStore
    // requires getSnapshot to return a cached reference).
    snapshot: { video: null, rect: null },
    listeners: new Set(),
    show(video, anchor) {
      store.snapshot = { video, rect: anchor.getBoundingClientRect() };
      for (const listener of store.listeners) listener();
    },
    hide() {
      if (!store.snapshot.video) return;
      store.snapshot = { video: null, rect: null };
      for (const listener of store.listeners) listener();
    },
  });

const DWELL_MS = 600;

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
      const anchor = e.currentTarget.querySelector<HTMLElement>("[data-thumb-anchor]");
      if (!anchor) return;
      const v = current.current;
      timer.current = setTimeout(() => {
        // The preview keys on the YouTube video id (it IS the id).
        if (!v.id) return;
        store.show(v, anchor);
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

const EMPTY_SNAPSHOT: PreviewSnapshot = { video: null, rect: null };

/**
 * Hidden park: offscreen at a stable nonzero size so the layer never
 * collapses while it is not showing.
 */
const PARKED_STYLE = { left: -10000, top: -10000, width: 320, height: 180 };

type Phase = "loading" | "storyboard" | "degraded";

/** The single shared preview layer (rendered once in the app shell). */
export function VideoHoverPreviewLayer() {
  const { video, rect } = usePreviewSnapshot();
  // phase for the CURRENTLY shown video only (reset per show)
  const [phase, setPhase] = useState<Phase>("loading");
  const [level, setLevel] = useState<StoryboardLevelDto | null>(null);
  const [frame, setFrame] = useState(0);

  const shownId = video?.id ?? null;

  // Reset the animation when the shown video changes — the sanctioned
  // adjust-during-render pattern (setState synchronously in an effect body
  // is the cascading-render anti-pattern the linter rightly rejects).
  const [resetFor, setResetFor] = useState<string | null>(shownId);
  if (resetFor !== shownId) {
    setResetFor(shownId);
    setPhase("loading");
    setLevel(null);
    setFrame(0);
  }

  // Hide when the page scrolls (the anchor rect would go stale).
  useEffect(() => {
    if (!video) return;
    const onScroll = () => store.hide();
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [video]);

  // Per shown video: fetch the storyboard (client-cached by fetchPlayback —
  // one request per video per session).
  useEffect(() => {
    if (shownId === null) return;
    let alive = true;
    void fetchPlayback(shownId).then((playback) => {
      if (!alive) return;
      const chosen = playback ? pickStoryboardLevel(playback.storyboards) : null;
      if (chosen) {
        setLevel(chosen);
        setPhase("storyboard");
      } else {
        setPhase("degraded"); // no storyboard — zoom/pan on the thumbnail
      }
    });
    return () => {
      alive = false;
    };
  }, [shownId]);

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
                phase !== "storyboard" && "wfx-kenburns"
              )}
            />
          ) : null}
          {phase === "loading" ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <span className="size-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            </div>
          ) : null}
          {geom ? (
            <div
              data-testid="storyboard-frame"
              className="absolute inset-0"
              style={{
                backgroundImage: `url("${geom.sheetUrl}")`,
                backgroundSize: geom.backgroundSize,
                backgroundPosition: geom.backgroundPosition,
                backgroundRepeat: "no-repeat",
                imageRendering: "auto",
              }}
            />
          ) : null}
        </div>
      ) : null}
      <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
        <PlayCircle className="size-3" aria-hidden="true" /> Preview
      </span>
    </div>
  );
}
