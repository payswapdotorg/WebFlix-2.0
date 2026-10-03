"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Volume2 } from "lucide-react";
import { loadYouTubeIframeApi } from "@/components/watch/youtube-player";
import { cn } from "@/lib/utils";

/**
 * YouTube-style hover preview (WFX2-P6-HP): ONE shared, muted, autoplaying
 * YouTube IFrame player follows the hovered card (fixed, over the thumbnail)
 * after a 600ms dwell — exactly what youtube.com's home grid does on hover.
 *
 * The store lives on globalThis so the layer (rendered from the app shell)
 * and the cards (page tree) always share ONE instance, even if the bundler
 * splits the module across chunk graphs.
 *
 * Playback is the REAL YouTube IFrame Player API — the same loader the
 * watch page uses (loadYouTubeIframeApi's module-level apiPromise singleton
 * → ONE iframe_api load per page, shared watch + preview). The preview
 * playerVars: autoplay + muted + chromeless (no controls, no branding, no
 * fullscreen, no keyboard). This replaces the old raw <video src=videoUrl>,
 * which could never play (videoUrl is the youtube.com/watch PAGE url).
 *
 * Lifecycle (performance-critical, mirrors youtube.com): the outer layer div
 * is ALWAYS mounted in the app shell; the YT.Player is created ONCE on the
 * first show ever and then reused — loadVideoById per hover (restarts from
 * 0, autoplays muted), pauseVideo on hide, NEVER destroyed on hide (instant
 * re-show, zero iframe churn). destroy() runs only on final unmount.
 */
type PreviewVideo = { id: string; title: string };

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
        // The preview player keys on the YouTube video id (it IS the id).
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

/** The YT player surface the preview needs (the watch player owns the full interface). */
interface PreviewPlayer {
  loadVideoById(options: { videoId: string }): void;
  pauseVideo(): void;
  destroy(): void;
}

/**
 * Hidden park: offscreen at a stable nonzero size so the reused iframe never
 * collapses while the layer is not showing.
 */
const PARKED_STYLE = { left: -10000, top: -10000, width: 320, height: 180 };

/** The single shared preview layer (rendered once in the app shell). */
export function VideoHoverPreviewLayer() {
  const { video, rect } = usePreviewSnapshot();
  // ONE player for the whole session — created on the first show, reused after.
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<PreviewPlayer | null>(null);
  const createdRef = useRef(false);
  const unmountedRef = useRef(false);
  const currentVideoIdRef = useRef<string | null>(null);
  // Track which video failed (unembeddable) so a different hover starts fresh.
  const [failedFor, setFailedFor] = useState<string | null>(null);
  // iframe_api unavailable (offline/blocked): degrade silently to thumbnails.
  const [apiDead, setApiDead] = useState(false);

  const failed = !!video && failedFor === video.id;
  const visible = !!video && !!rect && !failed && !apiDead;

  // Hide when the page scrolls (the anchor rect would go stale).
  useEffect(() => {
    if (!video) return;
    const onScroll = () => store.hide();
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [video]);

  // First show ever: create ONE muted autoplaying YT.Player in the container
  // (shares the watch page's iframe_api load — the loader's singleton).
  useEffect(() => {
    if (!video || createdRef.current || apiDead) return;
    const el = containerRef.current;
    if (!el) return;
    createdRef.current = true;
    void loadYouTubeIframeApi()
      .then((YT) => {
        const target = containerRef.current;
        if (unmountedRef.current || !target) return;
        const initialId = currentVideoIdRef.current;
        if (!initialId) return;
        const player: PreviewPlayer = new YT.Player(target, {
          videoId: initialId,
          width: "100%",
          height: "100%",
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
            // Unembeddable/removed video → hide for THAT video (the thumbnail
            // stays — never a broken box).
            onError: () => {
              const id = currentVideoIdRef.current;
              if (id) setFailedFor(id);
            },
          },
        });
        playerRef.current = player;
        // The hover may have moved on while the API loaded — catch up.
        const latestId = currentVideoIdRef.current;
        if (latestId && latestId !== initialId) {
          player.loadVideoById({ videoId: latestId });
        }
      })
      .catch(() => {
        // iframe_api offline/blocked: no preview, no crash, no console spam
        // (mirrors youtube-player.tsx — the thumbnail is the degrade state).
        setApiDead(true);
      });
  }, [video, apiDead]);

  // Every hovered video: (re)load into the reused player — restarts from 0
  // and autoplays muted. A known-failed (unembeddable) video is scoped by
  // id (failedFor === video.id): it simply stays on the thumbnail — no
  // flash, no retry loop — while any DIFFERENT video previews fine.
  useEffect(() => {
    if (!video) return;
    currentVideoIdRef.current = video.id;
    if (failedFor === video.id) return; // known-failed: stays on the thumbnail
    const p = playerRef.current;
    if (!p) return; // first show — the creation effect carries the id
    try {
      p.loadVideoById({ videoId: video.id });
    } catch {
      /* player gone — the thumbnail stays */
    }
  }, [video]);

  // Hide (mouseleave/scroll): pause — NEVER destroy (instant re-show).
  useEffect(() => {
    if (video) return;
    try {
      playerRef.current?.pauseVideo();
    } catch {
      /* player gone */
    }
  }, [video]);

  // The layer lives for the app shell's lifetime; destroy only on unmount.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      try {
        playerRef.current?.destroy();
      } catch {
        /* already destroyed */
      }
      playerRef.current = null;
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      data-hover-preview-layer=""
      data-testid={visible ? "hover-preview" : undefined}
      className={cn(
        "pointer-events-none fixed z-30 overflow-hidden rounded-xl border border-border/40 bg-black/20 shadow-2xl",
        !visible && "invisible"
      )}
      style={
        rect
          ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          : PARKED_STYLE
      }
    >
      {/* YT.Player replaces this div with the (reused) muted autoplaying iframe */}
      <div ref={containerRef} className="h-full w-full" />
      <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
        <Volume2 className="size-3" /> Muted preview
      </span>
    </div>
  );
}
