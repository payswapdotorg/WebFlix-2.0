"use client";

/**
 * P100-TIKTOK-LIVE — the native HLS rung of the playback ladder. The
 * viewer's browser fetches the stream bytes straight from TikTok's CDN (the
 * embed law's media twin: WebFlix servers never proxy media). hls.js is a
 * dynamic import (it only rides this rung), and EVERY failure path —
 * import failure, no MSE support, fatal stream error, CORS — hands control
 * back via onUnavailable so the ladder drops to the honest fallback rung
 * instead of showing a dead player.
 */
import { useEffect, useRef } from "react";

export function TikTokLivePlayer({
  src,
  onUnavailable,
}: {
  src: string;
  onUnavailable?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // the callback rides a ref so a fresh onUnavailable never re-arms the stream
  const unavailableRef = useRef(onUnavailable);
  useEffect(() => {
    unavailableRef.current = onUnavailable;
  }, [onUnavailable]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        const mod = await import("hls.js");
        const Hls = mod.default;
        const video = videoRef.current;
        if (cancelled || !video) return;
        if (!Hls.isSupported()) {
          // native HLS (Safari) or nothing — either way, this rung passes
          video.src = src;
          if (!video.canPlayType("application/vnd.apple.mpegurl")) {
            unavailableRef.current?.();
          }
          return;
        }
        const hls = new Hls({ enableWorker: false });
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data?.fatal) unavailableRef.current?.();
        });
        cleanup = () => hls.destroy();
      } catch {
        if (!cancelled) unavailableRef.current?.();
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
      data-testid="tiktok-live-video"
      controls
      muted
      playsInline
      className="aspect-video w-full rounded-lg bg-black"
      aria-label="TikTok live stream"
    />
  );
}
