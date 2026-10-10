"use client";

/**
 * Task 2-c — the embed-wall fallback chain, player side.
 *
 * Rendered into the persistent player wrapper (portal from PlayerHostLayer)
 * when the embed is confirmed BLOCKED (probe verdict / onError 101/150 /
 * dead iframe). The chain:
 *
 *   blocked → GET /api/videos/[id]/playback
 *     ├─ streamFormats → <NativeFallbackPlayer> — a native <video controls
 *     │   autoplay> fed by /api/stream (the server-side googlevideo proxy),
 *     │   same imperative-handle contract as YoutubePlayer so the miniplayer,
 *     │   keyboard shortcuts and queue engine keep working;
 *     ├─ no formats → <BlockedPlayerCard> — "Playback is blocked by YouTube
 *     │   in the embedded player" + [Open on YouTube] + [Retry embed];
 *     └─ fetch error → the card too (honest degrade).
 *
 * The page chrome (title, actions, comments) is untouched — only the player
 * area swaps.
 */
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
} from "react";
import { ExternalLink, Loader2, RotateCcw, ShieldAlert, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchPlayback } from "@/lib/watch/playback-client";
import {
  fireViewPing,
  saveProgressMemory,
  type YoutubePlayerHandle,
} from "@/components/watch/youtube-player";
import type { PlaybackDto, StreamFormatDto } from "@/lib/watch/types";

/** Best progressive format: itag 22 (720p) > 18 (360p) > rest by height. */
export function pickStreamFormat(formats: StreamFormatDto[]): StreamFormatDto | null {
  if (formats.length === 0) return null;
  const rank = (f: StreamFormatDto): number =>
    f.itag === 22 ? 2_000_000 : f.itag === 18 ? 1_000_000 : (f.height ?? 0) * 1_000;
  return formats.reduce((best, f) => (rank(f) > rank(best) ? f : best));
}

/* ------------------------------------------------------------------ */
/* The native <video> swap                                             */
/* ------------------------------------------------------------------ */

/** P12-UX — same policy window as the embed player's autoplay check. */
const AUTOPLAY_FALLBACK_MS = 1500;

interface NativeFallbackPlayerProps {
  videoId: string;
  format: StreamFormatDto;
  posterUrl: string | null;
  startSec: number | null;
  handleRef?: Ref<YoutubePlayerHandle>;
  onProgress?: (sec: number, durationSec: number) => void;
  onEnded?: () => void;
  onStateChange?: (state: "playing" | "paused" | "ended" | "error") => void;
  /** fired when the proxied stream itself fails → the caller shows the card */
  onFatal?: () => void;
}

export function NativeFallbackPlayer({
  videoId,
  format,
  posterUrl,
  startSec,
  handleRef,
  onProgress,
  onEnded,
  onStateChange,
  onFatal,
}: NativeFallbackPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const resumeAppliedRef = useRef(false);
  const lastPersistRef = useRef(0);
  const viewPingedRef = useRef(false);
  // P12-UX — autoplay-policy parity with the embed player: the <video
  // autoPlay> attribute attempts playback WITH sound; if the browser
  // blocked it (still paused ~1.5s in), mute + retry + surface the
  // tap-to-unmute affordance (the native controls can also unmute).
  const [mutedAutostart, setMutedAutostart] = useState(false);

  const src = useMemo(
    () => `/api/stream?url=${encodeURIComponent(format.url)}`,
    [format.url]
  );

  // P12-UX — reset per stream via the sanctioned adjust-during-render
  // pattern (setState in an effect body is the cascading anti-pattern).
  const [resetFor, setResetFor] = useState(src);
  if (resetFor !== src) {
    setResetFor(src);
    setMutedAutostart(false);
  }

  // P12-UX — the muted-autostart fallback (see state comment above).
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const t = setTimeout(() => {
      if (!v.paused) return; // autoplay took — with sound
      v.muted = true;
      try {
        const p = v.play();
        if (p && typeof p.then === "function") {
          p.then(() => setMutedAutostart(true)).catch(() => {
            /* even muted failed — the controls remain */
          });
        } else {
          setMutedAutostart(true);
        }
      } catch {
        /* runtime without media playback — the controls remain */
      }
    }, AUTOPLAY_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [src]);

  // stable callbacks
  const onProgressRef = useRef(onProgress);
  const onEndedRef = useRef(onEnded);
  const onStateChangeRef = useRef(onStateChange);
  const onFatalRef = useRef(onFatal);
  useEffect(() => {
    onProgressRef.current = onProgress;
    onEndedRef.current = onEnded;
    onStateChangeRef.current = onStateChange;
    onFatalRef.current = onFatal;
  });

  const persist = useCallback(
    (sec: number) => {
      if (sec > 0) saveProgressMemory(videoId, sec);
    },
    [videoId]
  );

  // resume position + view ping once metadata is in
  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!resumeAppliedRef.current) {
      resumeAppliedRef.current = true;
      const seekTo =
        startSec !== null && startSec > 0 && startSec < (v.duration || Infinity)
          ? startSec
          : null;
      if (seekTo !== null) v.currentTime = seekTo;
    }
    if (!viewPingedRef.current) {
      viewPingedRef.current = true;
      void fireViewPing(videoId, 0);
    }
  }, [startSec, videoId]);

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    onProgressRef.current?.(v.currentTime, Number.isFinite(v.duration) ? v.duration : 0);
    // persist ~every 5s while playing (the embed player's cadence)
    if (v.currentTime - lastPersistRef.current >= 5) {
      lastPersistRef.current = v.currentTime;
      persist(v.currentTime);
    }
  }, [persist]);

  const handleEnded = useCallback(() => {
    const v = videoRef.current;
    persist(v?.currentTime ?? 0);
    onStateChangeRef.current?.("ended");
    onEndedRef.current?.();
  }, [persist]);

  // the SAME imperative-handle contract as YoutubePlayer — the miniplayer,
  // keyboard shortcuts and queue engine keep working on the native player
  useImperativeHandle(
    handleRef,
    () => ({
      play: () => void videoRef.current?.play().catch(() => {}),
      pause: () => videoRef.current?.pause(),
      togglePlay: () => {
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) void v.play().catch(() => {});
        else v.pause();
      },
      seekTo: (sec: number) => {
        const v = videoRef.current;
        if (v) v.currentTime = sec;
      },
      getCurrentTime: () => videoRef.current?.currentTime ?? 0,
      getDuration: () =>
        videoRef.current && Number.isFinite(videoRef.current.duration)
          ? videoRef.current.duration
          : 0,
    }),
    []
  );

  return (
    <div className="absolute inset-0 h-full w-full">
      <video
        ref={videoRef}
        key={src}
        src={src}
        poster={posterUrl ?? undefined}
        controls
        autoPlay
        playsInline
        preload="metadata"
        aria-label={`Play ${videoId}`}
        className="absolute inset-0 h-full w-full bg-black object-contain"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => onStateChangeRef.current?.("playing")}
        onPause={() => {
          onStateChangeRef.current?.("paused");
          const v = videoRef.current;
          if (v) persist(v.currentTime);
        }}
        onEnded={handleEnded}
        onError={() => {
          onStateChangeRef.current?.("error");
          onFatalRef.current?.();
        }}
      />
      {mutedAutostart && (
        <button
          type="button"
          onClick={() => {
            const v = videoRef.current;
            if (v) {
              v.muted = false;
              try {
                const p = v.play();
                if (p && typeof p.catch === "function") p.catch(() => {});
              } catch {
                /* keep — the controls remain */
              }
            }
            setMutedAutostart(false);
          }}
          aria-label="Tap to unmute"
          className="absolute bottom-3 left-3 z-10 flex min-h-11 items-center gap-1.5 rounded-full bg-black/80 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-black"
        >
          <VolumeX className="size-4" aria-hidden="true" />
          Tap to unmute
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The final fallback card                                             */
/* ------------------------------------------------------------------ */

export function BlockedPlayerCard({
  videoId,
  onRetry,
  detail,
}: {
  videoId: string;
  onRetry: () => void;
  /** what went wrong beyond the wall (e.g. the stream swap also failed) */
  detail?: string | null;
}) {
  return (
    <div
      role="region"
      aria-label="Playback unavailable in the embedded player"
      className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black px-4 py-6 text-center sm:px-8"
    >
      <ShieldAlert className="size-10 shrink-0 text-white/70 sm:size-12" aria-hidden="true" />
      <div className="max-w-md">
        <p className="text-base font-semibold text-white sm:text-lg">
          This video can&apos;t play here right now
        </p>
        <p className="mt-1.5 text-sm text-white/70">
          {detail ??
            "YouTube is asking this browser to confirm you're not a bot before it will play this video here, and every alternate playback path (the player clients, the watch page, the broker) came back empty. Signing in on youtube.com in this browser usually clears the check — then come back and retry."}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild className="bg-yt-red text-white hover:bg-yt-red/90">
          <a
            href={`https://www.youtube.com/watch?v=${videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open this video on YouTube in a new tab"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            Open on YouTube
          </a>
        </Button>
        <Button
          asChild
          variant="outline"
          className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
        >
          <a
            href="https://www.youtube.com/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open youtube.com to sign in, in a new tab"
          >
            Sign in on youtube.com
          </a>
        </Button>
        <Button
          variant="outline"
          onClick={onRetry}
          aria-label="Retry the embedded YouTube player"
          className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Retry embed
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The chain orchestrator (rendered into the persistent wrapper)        */
/* ------------------------------------------------------------------ */

export function PlayerFallback({
  videoId,
  startSec,
  posterUrl,
  handleRef,
  onProgress,
  onEnded,
  onStateChange,
  onRetryEmbed,
}: {
  videoId: string;
  startSec: number | null;
  posterUrl: string | null;
  handleRef?: Ref<YoutubePlayerHandle>;
  onProgress?: (sec: number, durationSec: number) => void;
  onEnded?: () => void;
  onStateChange?: (state: "playing" | "paused" | "ended" | "error") => void;
  /** "Retry embed" — clears the blocked verdict; the layer re-creates the iframe. */
  onRetryEmbed: () => void;
}) {
  const [playback, setPlayback] = useState<PlaybackDto | null | "loading">("loading");
  const [streamFailed, setStreamFailed] = useState(false);

  // Reset the per-video state when videoId changes — the sanctioned
  // adjust-during-render pattern (setState synchronously in an effect body
  // is the cascading-render anti-pattern the linter rightly rejects).
  const [resetFor, setResetFor] = useState(videoId);
  if (resetFor !== videoId) {
    setResetFor(videoId);
    setPlayback("loading");
    setStreamFailed(false);
  }

  useEffect(() => {
    let alive = true;
    void fetchPlayback(videoId).then((p) => {
      if (alive) setPlayback(p);
    });
    return () => {
      alive = false;
    };
  }, [videoId]);

  const format = useMemo(
    () => (playback && playback !== "loading" ? pickStreamFormat(playback.streamFormats) : null),
    [playback]
  );

  return (
    <div className="relative h-full w-full bg-black">
      {playback === "loading" ? (
        <div
          role="status"
          aria-label="Trying alternate playback"
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black text-white/80"
        >
          {posterUrl ? (
            <img
              src={posterUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-40"
            />
          ) : null}
          <Loader2 className="size-8 animate-spin" aria-hidden="true" />
          <p className="relative text-sm font-medium">Trying alternate playback…</p>
        </div>
      ) : format && !streamFailed ? (
        <NativeFallbackPlayer
          videoId={videoId}
          format={format}
          posterUrl={posterUrl}
          startSec={startSec}
          handleRef={handleRef}
          onProgress={onProgress}
          onEnded={onEnded}
          onStateChange={onStateChange}
          onFatal={() => setStreamFailed(true)}
        />
      ) : (
        <BlockedPlayerCard
          videoId={videoId}
          onRetry={onRetryEmbed}
          detail={
            streamFailed
              ? "The alternate stream could not be played either — try the video on YouTube."
              : null
          }
        />
      )}
    </div>
  );
}

