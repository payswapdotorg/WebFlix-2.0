"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Volume2 } from "lucide-react";

/**
 * YouTube-style hover preview: ONE shared <video> element follows the hovered
 * card (fixed, over the thumbnail) and plays muted after a 600ms dwell.
 *
 * The store lives on globalThis so the layer (rendered from the root layout
 * tree) and the cards (page tree) always share ONE instance, even if the
 * bundler splits the module across chunk graphs.
 */
type PreviewVideo = { id: string; videoUrl: string; title: string };

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
        if (!v.videoUrl) return;
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

/** The single shared preview layer (rendered once in the app shell). */
export function VideoHoverPreviewLayer() {
  const { video, rect } = usePreviewSnapshot();
  const ref = useRef<HTMLVideoElement>(null);
  // Track which video failed so a different hover starts fresh.
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const failed = !!video && failedFor === video.id;

  // Hide when the page scrolls (the anchor rect would go stale).
  useEffect(() => {
    if (!video) return;
    const onScroll = () => store.hide();
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [video]);

  // Restart playback for each new hovered video.
  useEffect(() => {
    if (!video || !ref.current) return;
    ref.current.currentTime = 0;
    void ref.current.play().catch(() => undefined);
  }, [video]);

  if (!video || !rect || failed) return null;

  return (
    <div
      aria-hidden="true"
      data-testid="hover-preview"
      className="pointer-events-none fixed z-30 overflow-hidden rounded-xl border border-border/40 bg-black/20 shadow-2xl"
      style={{
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }}
    >
      <video
        ref={ref}
        src={video.videoUrl}
        muted
        loop
        playsInline
        autoPlay
        preload="auto"
        onError={() => setFailedFor(video.id)}
        className="h-full w-full object-cover"
      />
      <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
        <Volume2 className="size-3" /> Muted preview
      </span>
    </div>
  );
}
