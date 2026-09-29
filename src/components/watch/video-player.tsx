"use client";

/**
 * WFX2-W video player — a real custom control bar (no browser controls):
 * play/pause (click + k), seek with buffered + hover tooltip + chapters,
 * j/l (±10s), arrows (±5s), volume slider + mute (m), playback speed
 * (0.25–2, shift+./,), settings gear, captions from transcript cues (c),
 * theater (t), fullscreen (f), 0–9 percent seek, autoplay-next toggle
 * persisted in localStorage, 5s progress auto-save + resume-on-load, and
 * the end-of-video autoplay countdown overlay with cancel.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  Maximize,
  Minimize,
  Pause,
  Play,
  RectangleHorizontal,
  Settings,
  SkipForward,
  Subtitles,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/watch/format";
import { post } from "@/lib/watch/client";
import { activeChapterIndex, type Chapter } from "@/lib/watch/chapters";
import { activeCueIndex } from "@/lib/watch/transcript";
import type { RelatedVideoDto, TranscriptCueDto } from "@/lib/watch/types";
import { SeekBar } from "./seek-bar";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const AUTOPLAY_KEY = "wfx2-autoplay";
const VOLUME_KEY = "wfx2-volume";
const PROGRESS_INTERVAL_MS = 5000;
const COUNTDOWN_SEC = 8;

export interface PlayerHandle {
  seekTo: (sec: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
}

interface VideoPlayerProps {
  videoId: string;
  src: string;
  poster: string;
  durationSec: number;
  resumeSec: number | null;
  startAt: number | null;
  chapters: Chapter[];
  cues: TranscriptCueDto[];
  cuesReady: boolean;
  theater: boolean;
  onToggleTheater: () => void;
  nextVideo: RelatedVideoDto | null;
  onOpenTranscript?: () => void;
  onTimeUpdate?: (t: number) => void;
}

function localStorageGet(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export const VideoPlayer = forwardRef<PlayerHandle, VideoPlayerProps>(function VideoPlayer(
  {
    videoId,
    src,
    poster,
    durationSec,
    resumeSec,
    startAt,
    chapters,
    cues,
    cuesReady,
    theater,
    onToggleTheater,
    nextVideo,
    onOpenTranscript,
    onTimeUpdate,
  },
  ref
) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchedRef = useRef(0);
  const progressSaverRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [current, setCurrent] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [duration, setDuration] = useState(durationSec || 0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [ccOn, setCcOn] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const controlsVisible = !playing || chromeVisible || menuOpen;
  const [scrubbing, setScrubbing] = useState(false);
  const [previewSec, setPreviewSec] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [resumeApplied, setResumeApplied] = useState(false);
  const [toastInfo, setToastInfo] = useState<string | null>(null);

  // ---- persisted prefs ---------------------------------------------------
  // localStorage hydration after mount (SSR-safe: server renders defaults).
  // Sync setState in this one effect is the React-documented pattern for
  // client-only persisted values (see react.dev "You Might Not Need an Effect").
  useEffect(() => {
    const savedVol = parseFloat(localStorageGet(VOLUME_KEY, "1"));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration of persisted prefs
    if (Number.isFinite(savedVol)) setVolume(Math.min(1, Math.max(0, savedVol)));
    setAutoplay(localStorageGet(AUTOPLAY_KEY, "1") === "1");
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(AUTOPLAY_KEY, autoplay ? "1" : "0");
    } catch {}
  }, [autoplay]);

  useEffect(() => {
    try {
      window.localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {}
  }, [volume]);

  // ---- imperative handle ------------------------------------------------
  const seekTo = useCallback(
    (sec: number) => {
      const v = videoRef.current;
      if (!v) return;
      const target = Math.min(Math.max(0, sec), v.duration || duration || sec);
      v.currentTime = target;
      setCurrent(target);
      setEnded(false);
      setCountdown(null);
      if (v.paused) void v.play().catch(() => {});
    },
    [duration]
  );

  useImperativeHandle(ref, () => ({
    seekTo,
    play: () => void videoRef.current?.play().catch(() => {}),
    pause: () => videoRef.current?.pause(),
    togglePlay: () => {
      const v = videoRef.current;
      if (!v) return;
      if (v.paused) void v.play().catch(() => {});
      else v.pause();
    },
  }));

  // ---- media events -----------------------------------------------------
  const saveProgress = useCallback(
    (lastPositionSec: number) => {
      const watched = Math.max(watchedRef.current, Math.floor(lastPositionSec));
      watchedRef.current = watched;
      void post(`/api/videos/${videoId}/progress`, {
        watchedSec: watched,
        lastPositionSec: Math.floor(lastPositionSec),
      }).catch(() => {});
    },
    [videoId]
  );

  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
    v.volume = volume;
    v.muted = muted;
    if (!resumeApplied) {
      setResumeApplied(true);
      if (startAt !== null && startAt > 0 && startAt < (v.duration || 1e9)) {
        v.currentTime = startAt;
        setCurrent(startAt);
      } else if (
        resumeSec !== null &&
        resumeSec >= 10 &&
        resumeSec <= 0.9 * (v.duration || Infinity)
      ) {
        v.currentTime = resumeSec;
        setCurrent(resumeSec);
        setToastInfo(`Resumed from ${formatDuration(resumeSec)}`);
        setTimeout(() => setToastInfo(null), 2600);
      }
    }
  }, [muted, resumeApplied, resumeSec, startAt, volume]);

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!scrubbing) setCurrent(v.currentTime);
    onTimeUpdate?.(v.currentTime);
    // buffered extent
    if (v.buffered.length > 0) {
      let end = 0;
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime) end = Math.max(end, v.buffered.end(i));
      }
      setBuffered(Math.min(end, v.duration || end));
    }
  }, [onTimeUpdate, scrubbing]);

  const handleEnded = useCallback(() => {
    setPlaying(false);
    setEnded(true);
    setChromeVisible(true);
    saveProgress(duration || videoRef.current?.duration || 0);
    if (autoplay && nextVideo) {
      setCountdown(COUNTDOWN_SEC);
    }
  }, [autoplay, duration, nextVideo, saveProgress]);

  // countdown → autoplay next
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      if (nextVideo) router.push(`/watch/${nextVideo.id}`);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, nextVideo, router]);

  // periodic progress save (every 5s while playing)
  useEffect(() => {
    if (!playing) {
      if (progressSaverRef.current) clearInterval(progressSaverRef.current);
      progressSaverRef.current = null;
      return;
    }
    progressSaverRef.current = setInterval(() => {
      const v = videoRef.current;
      if (v && !v.paused) saveProgress(v.currentTime);
    }, PROGRESS_INTERVAL_MS);
    return () => {
      if (progressSaverRef.current) clearInterval(progressSaverRef.current);
    };
  }, [playing, saveProgress]);

  // save on unload/visibility hidden
  useEffect(() => {
    const flush = () => {
      const v = videoRef.current;
      if (v && v.currentTime > 0) saveProgress(v.currentTime);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, [saveProgress]);

  // pause saves progress
  const handlePause = useCallback(() => {
    setPlaying(false);
    setChromeVisible(true);
    const v = videoRef.current;
    if (v && v.currentTime > 0) saveProgress(v.currentTime);
  }, [saveProgress]);

  // ---- fullscreen -------------------------------------------------------
  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void el.requestFullscreen?.().catch(() => {});
    }
  }, []);

  // ---- controls auto-hide (derived: visible when paused OR chrome poked) --
  const pokeControls = useCallback(() => {
    setChromeVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      const v = videoRef.current;
      if (v && !v.paused && !menuOpen) setChromeVisible(false);
    }, 3000);
  }, [menuOpen]);

  // ---- keyboard shortcuts (global, YouTube-style) -------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          (target as HTMLElement).closest?.("[role=menu], [role=dialog]"))
      ) {
        return;
      }
      const v = videoRef.current;
      if (!v) return;
      const key = e.key.toLowerCase();

      const bumpVolume = (delta: number) => {
        e.preventDefault();
        const next = Math.min(1, Math.max(0, v.volume + delta));
        v.volume = next;
        v.muted = false;
        setVolume(next);
        setMuted(false);
      };

      if (key === "k" || key === " ") {
        e.preventDefault();
        if (v.paused) void v.play().catch(() => {});
        else v.pause();
      } else if (key === "j") {
        e.preventDefault();
        seekTo(v.currentTime - 10);
      } else if (key === "l") {
        e.preventDefault();
        seekTo(v.currentTime + 10);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekTo(v.currentTime - 5);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seekTo(v.currentTime + 5);
      } else if (e.key === "ArrowUp") {
        bumpVolume(0.05);
      } else if (e.key === "ArrowDown") {
        bumpVolume(-0.05);
      } else if (key === "m") {
        e.preventDefault();
        v.muted = !v.muted;
        setMuted(v.muted);
      } else if (key === "f") {
        e.preventDefault();
        toggleFullscreen();
      } else if (key === "t") {
        e.preventDefault();
        onToggleTheater();
      } else if (key === "c") {
        e.preventDefault();
        setCcOn((c) => !c);
      } else if (/^[0-9]$/.test(key) && duration > 0) {
        e.preventDefault();
        seekTo((parseInt(key, 10) / 10) * duration);
      } else if (key === "home") {
        e.preventDefault();
        seekTo(0);
      } else if (key === "end") {
        e.preventDefault();
        seekTo(duration - 1);
      } else if (e.key === "<" || (e.shiftKey && key === ",")) {
        e.preventDefault();
        const idx = SPEEDS.indexOf(speed);
        const next = SPEEDS[Math.max(0, (idx === -1 ? 3 : idx) - 1)];
        v.playbackRate = next;
        setSpeed(next);
      } else if (e.key === ">" || (e.shiftKey && key === ".")) {
        e.preventDefault();
        const idx = SPEEDS.indexOf(speed);
        const next = SPEEDS[Math.min(SPEEDS.length - 1, (idx === -1 ? 3 : idx) + 1)];
        v.playbackRate = next;
        setSpeed(next);
      } else if (key === "escape" && countdown !== null) {
        setCountdown(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [countdown, duration, onToggleTheater, seekTo, speed, toggleFullscreen]);

  // ---- click surface: single = play/pause, double = fullscreen ------------
  const handleSurfaceClick = () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      toggleFullscreen();
      return;
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      const v = videoRef.current;
      if (!v) return;
      if (countdown !== null) return; // don't restart while countdown overlay shows
      if (v.paused) void v.play().catch(() => {});
      else v.pause();
    }, 220);
  };

  // ---- captions ----------------------------------------------------------
  const cueIdx = useMemo(() => (ccOn && cues.length ? activeCueIndex(cues, current) : -1), [ccOn, cues, current]);
  const chapterIdx = useMemo(() => activeChapterIndex(chapters, current), [chapters, current]);
  const activeChapter = chapterIdx >= 0 ? chapters[chapterIdx] : null;

  const volumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const VolumeIcon = volumeIcon;

  return (
    <div
      ref={containerRef}
      onMouseMove={pokeControls}
      onMouseLeave={() => {
        if (playing && !menuOpen) setChromeVisible(false);
      }}
      className={cn(
        "group/player relative aspect-video w-full overflow-hidden bg-black",
        !fullscreen && (theater ? "rounded-none" : "rounded-xl")
      )}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        preload="metadata"
        playsInline
        aria-label="Video player"
        onClick={handleSurfaceClick}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => {
          setPlaying(true);
          setEnded(false);
          pokeControls();
        }}
        onPause={handlePause}
        onEnded={handleEnded}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onVolumeChange={(e) => {
          const v = e.currentTarget;
          setVolume(v.volume);
          setMuted(v.muted);
        }}
        className="absolute inset-0 h-full w-full cursor-pointer object-contain"
      />

      {/* center big play button (initial/ended states) */}
      {(!playing || waiting) && !ended && (
        <button
          type="button"
          onClick={handleSurfaceClick}
          aria-label={playing ? "Video buffering" : "Play video"}
          className="absolute inset-0 m-auto flex size-16 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm transition hover:bg-black/70"
        >
          {waiting && playing ? (
            <span
              aria-hidden="true"
              className="size-8 animate-spin rounded-full border-[3px] border-white/30 border-t-white"
            />
          ) : (
            <Play className="size-8 fill-white text-white" aria-hidden="true" />
          )}
        </button>
      )}

      {/* captions */}
      {ccOn && cueIdx >= 0 && (
        <div
          aria-live="polite"
          className="pointer-events-none absolute bottom-16 left-1/2 max-w-[80%] -translate-x-1/2 rounded bg-black/80 px-3 py-1.5 text-center text-sm font-medium leading-snug text-white sm:bottom-20 sm:text-base"
        >
          {cues[cueIdx].text}
        </div>
      )}

      {/* toast (resume info) */}
      {toastInfo && (
        <div className="absolute left-3 top-3 z-20 rounded-md bg-black/80 px-3 py-1.5 text-xs font-medium text-white">
          {toastInfo}
        </div>
      )}

      {/* autoplay countdown overlay */}
      {countdown !== null && nextVideo && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70">
          <div className="mx-4 flex w-full max-w-md items-center gap-4 rounded-xl bg-white p-4 shadow-2xl">
            <div className="relative size-20 shrink-0">
              <svg viewBox="0 0 36 36" className="size-20 -rotate-90">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e5e5e5" strokeWidth="3" />
                <circle
                  cx="18"
                  cy="18"
                  r="15.5"
                  fill="none"
                  stroke="#f03"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 15.5}
                  strokeDashoffset={2 * Math.PI * 15.5 * (1 - countdown / COUNTDOWN_SEC)}
                  className="transition-[stroke-dashoffset] duration-1000 ease-linear"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xl font-semibold tabular-nums">
                {countdown}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium uppercase tracking-wide text-[#606060]">
                Playing next
              </div>
              <div className="mt-0.5 line-clamp-2 text-sm font-semibold">{nextVideo.title}</div>
              <div className="mt-1 text-xs text-[#606060]">{nextVideo.channel.name}</div>
            </div>
            <button
              type="button"
              onClick={() => setCountdown(null)}
              className="ml-2 shrink-0 rounded-full bg-[#f03] px-4 py-2 text-sm font-medium text-white hover:bg-[#d0021f]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* control bar */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2 pb-1 pt-8 transition-opacity duration-200 sm:px-4 sm:pb-2",
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onMouseEnter={() => setChromeVisible(true)}
      >
        <SeekBar
          duration={duration}
          current={current}
          buffered={buffered}
          chapters={chapters}
          disabled={duration <= 0}
          onSeek={seekTo}
          onScrubStart={() => setScrubbing(true)}
          onScrubEnd={() => setScrubbing(false)}
          onPreview={setPreviewSec}
        />
        <div className="mt-1 flex items-center gap-0.5 text-white sm:gap-1">
          <IconButton label={playing ? "Pause (k)" : "Play (k)"} onClick={handleSurfaceClick}>
            {playing ? (
              <Pause className="size-5 fill-white sm:size-6" aria-hidden="true" />
            ) : (
              <Play className="size-5 fill-white sm:size-6" aria-hidden="true" />
            )}
          </IconButton>

          {nextVideo && (
            <IconButton label="Play next video" onClick={() => router.push(`/watch/${nextVideo.id}`)}>
              <SkipForward className="size-5 fill-white sm:size-6" aria-hidden="true" />
            </IconButton>
          )}

          {/* volume: mute + hover slider */}
          <div className="group/vol flex items-center">
            <IconButton
              label={muted ? "Unmute (m)" : "Mute (m)"}
              onClick={() => {
                const v = videoRef.current;
                if (!v) return;
                v.muted = !v.muted;
                setMuted(v.muted);
              }}
            >
              {<VolumeIcon className="size-5 fill-white sm:size-6" />}
            </IconButton>
            <div
              className="w-0 overflow-hidden opacity-0 transition-all duration-150 group-focus-within/vol:w-20 group-focus-within/vol:opacity-100 group-hover/vol:w-20 group-hover/vol:opacity-100"
              role="slider"
              aria-label="Volume slider"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((muted ? 0 : volume) * 100)}
              tabIndex={0}
              onKeyDown={(e) => {
                const v = videoRef.current;
                if (!v) return;
                if (e.key === "ArrowLeft") {
                  v.volume = Math.max(0, v.volume - 0.05);
                  v.muted = false;
                } else if (e.key === "ArrowRight") {
                  v.volume = Math.min(1, v.volume + 0.05);
                  v.muted = false;
                }
              }}
            >
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  const v = videoRef.current;
                  setVolume(val);
                  setMuted(val === 0);
                  if (v) {
                    v.volume = val;
                    v.muted = false;
                  }
                }}
                aria-label="Volume"
                className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/40 accent-[#f03] [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                style={{
                  background: `linear-gradient(to right, #fff ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,0.4) ${(muted ? 0 : volume) * 100}%)`,
                }}
              />
            </div>
          </div>

          {/* time + active chapter */}
          <div className="ml-1 flex min-w-0 items-baseline gap-2 text-xs tabular-nums sm:text-[13px]">
            <span className="font-medium">
              {formatDuration(current)}
              <span className="mx-1 text-white/60">/</span>
              <span className="text-white/90">{formatDuration(duration)}</span>
            </span>
            {activeChapter && (
              <span className="hidden truncate text-white/70 sm:inline">{activeChapter.title}</span>
            )}
          </div>

          <div className="flex-1" />

          {/* autoplay toggle */}
          <button
            type="button"
            role="switch"
            aria-checked={autoplay}
            aria-label={`Autoplay is ${autoplay ? "on" : "off"}`}
            title={`Autoplay is ${autoplay ? "on" : "off"}`}
            onClick={() => setAutoplay((a) => !a)}
            className="mx-1 flex h-8 items-center gap-1.5 rounded-md px-1.5 hover:bg-white/10"
          >
            <span className="hidden text-[10px] font-medium uppercase tracking-wide text-white/80 sm:inline">
              Autoplay
            </span>
            <span
              className={cn(
                "flex h-4 w-7 items-center rounded-full px-0.5 transition-colors",
                autoplay ? "bg-[#f03]" : "bg-white/30"
              )}
            >
              <span
                className={cn(
                  "size-3 rounded-full bg-white transition-transform",
                  autoplay && "translate-x-3"
                )}
              />
            </span>
          </button>

          {/* captions */}
          <IconButton
            label="Subtitles/closed captions (c)"
            active={ccOn}
            disabled={!cuesReady || cues.length === 0}
            onClick={() => setCcOn((c) => !c)}
          >
            <Subtitles className="size-5 sm:size-6" aria-hidden="true" />
          </IconButton>

          {/* settings gear + speed menu */}
          <div className="relative">
            <IconButton
              label="Settings"
              active={speed !== 1}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <Settings className="size-5 sm:size-6" aria-hidden="true" />
            </IconButton>
            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setMenuOpen(false)}
                  aria-hidden="true"
                />
                <div
                  role="menu"
                  aria-label="Player settings"
                  className="absolute bottom-[calc(100%+8px)] right-0 z-40 w-56 rounded-xl bg-black/95 py-2 text-sm text-white shadow-xl ring-1 ring-white/10"
                >
                  <div className="px-3 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-white/50">
                    Playback speed
                  </div>
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="menuitemradio"
                      aria-checked={speed === s}
                      onClick={() => {
                        const v = videoRef.current;
                        if (v) v.playbackRate = s;
                        setSpeed(s);
                        setMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/10"
                    >
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          speed === s ? "bg-[#f03]" : "bg-transparent"
                        )}
                      />
                      {s === 1 ? "Normal" : `${s}x`}
                    </button>
                  ))}
                  <div className="my-1 h-px bg-white/10" />
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={ccOn}
                    disabled={!cuesReady || cues.length === 0}
                    onClick={() => setCcOn((c) => !c)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/10 disabled:opacity-40"
                  >
                    <Subtitles className="size-4" aria-hidden="true" />
                    Subtitles/CC
                    <span className="ml-auto text-xs text-white/60">{ccOn ? "On" : "Off"}</span>
                  </button>
                </div>
              </>
            )}
          </div>

          <IconButton label="Open transcript" onClick={onOpenTranscript} className="hidden sm:inline-flex">
            <span className="text-[11px] font-semibold uppercase tracking-wide">Transcript</span>
          </IconButton>

          {/* theater */}
          <IconButton label={theater ? "Default view (t)" : "Theater mode (t)"} onClick={onToggleTheater}>
            <RectangleHorizontal className="size-5 sm:size-6" aria-hidden="true" />
          </IconButton>

          {/* fullscreen */}
          <IconButton
            label={fullscreen ? "Exit full screen (f)" : "Full screen (f)"}
            onClick={toggleFullscreen}
          >
            {fullscreen ? (
              <Minimize className="size-5 sm:size-6" aria-hidden="true" />
            ) : (
              <Maximize className="size-5 sm:size-6" aria-hidden="true" />
            )}
          </IconButton>
        </div>
      </div>
    </div>
  );
});

function IconButton({
  label,
  onClick,
  active,
  disabled,
  className,
  children,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-11 w-11 items-center justify-center rounded-md transition hover:bg-white/10 active:scale-95 disabled:opacity-40 disabled:active:scale-100 sm:h-10 sm:w-10",
        active && "text-[#f03]",
        className
      )}
    >
      {children}
    </button>
  );
}
