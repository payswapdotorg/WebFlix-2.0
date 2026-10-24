"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import {
  ArrowLeft,
  Loader2,
  Volume2,
  VolumeX,
  Maximize,
  RotateCcw,
  KeyRound,
  Timer,
  ExternalLink,
  Minus,
  Plus,
} from "lucide-react";
import { useApi } from "@/hooks/use-api";
import type { NetflixTitlePageDTO } from "@/lib/netflix/types";

/**
 * P43 — the Netflix watch view.
 *
 * The playback engine is the WebFlix Netflix Desktop session (a real Chrome
 * with Widevine inside a cloud desktop, signed into Netflix) streamed
 * interactively via noVNC and audible via the PulseAudio→Opus WebSocket tap.
 * The viewer rides Netflix's own player UI inside the window — WebFlix adds
 * only the room chrome (back, audio, sync, fullscreen).
 */

interface WatchSessionStatus {
  phase: "idle" | "provisioning" | "stream-ready" | "restoring-session" | "auth-required" | "ready" | "error" | "unreachable";
  sandboxId?: string | null;
  streamUrl?: string | null;
  message?: string | null;
  videoId?: number | null;
  audioRunning?: boolean;
}

const PHASE_STEPS: Array<{ key: string; label: string }> = [
  { key: "provisioning", label: "Starting the secure cloud desktop" },
  { key: "stream-ready", label: "Opening Netflix in Chrome" },
  { key: "restoring-session", label: "Restoring your Netflix session" },
  { key: "ready", label: "Ready" },
];

export default function NetflixWatchView() {
  const params = useParams<{ id: string }>();
  const rawId = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const netflixId = Number(rawId);
  // P44 — the Netflix Live lane: rawId "live" streams the full real Netflix UI
  // (browse/search/my-list) instead of a single title deep link.
  const isLive = rawId === "live";
  const valid = isLive || (Number.isInteger(netflixId) && netflixId > 0);

  const { data: titleData } = useApi<NetflixTitlePageDTO>(
    valid && !isLive ? `/api/netflix/title/${netflixId}` : null
  );
  const title = titleData?.title ?? null;

  const [status, setStatus] = useState<WatchSessionStatus | null>(null);
  const kickedRef = useRef(false);
  const [cookiePanelOpen, setCookiePanelOpen] = useState(false);
  const [cookieInput, setCookieInput] = useState("");
  const [cookieResult, setCookieResult] = useState<string | null>(null);
  const [cookieBusy, setCookieBusy] = useState(false);
  // instant paste feedback: Netflix only truly needs the two session cookies.
  // `NetflixId` must be a STANDALONE name — a bare `SecureNetflixId=` paste
  // (which contains "NetflixId" as a substring) is NOT enough on its own.
  const cookieLooksValid = /(?<![A-Za-z])NetflixId\s*=/.test(cookieInput);
  const [authRetryBusy, setAuthRetryBusy] = useState(false);
  const [streamError, setStreamError] = useState(false);

  // audio state
  const [audioOn, setAudioOn] = useState(true);
  const [audioOk, setAudioOk] = useState(false);
  const [audioOffsetMs, setAudioOffsetMs] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<ArrayBuffer[]>([]);
  const sourceBufRef = useRef<SourceBuffer | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const targetLatencyRef = useRef(1.0);
  const offsetRef = useRef(0);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/netflix/watch/session", { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as WatchSessionStatus;
      // change-guard: the poll ticks every 2.5s — re-render only on a real
      // phase/status change (keeps the room chrome steady under interaction)
      setStatus((prev) =>
        prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next
      );
    } catch {
      /* transient */
    }
  }, []);

  // what we ask the broker for on entry/restart: the deep link for a title,
  // the browse lane for Netflix Live
  const kickBody = useCallback(
    () => (isLive ? { path: "/browse" } : { videoId: netflixId }),
    [isLive, netflixId]
  );

  // kick the session once, then poll until terminal-ish phases
  useEffect(() => {
    if (!valid || kickedRef.current) return;
    kickedRef.current = true;
    void (async () => {
      try {
        await fetch("/api/netflix/watch/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(kickBody()),
        });
      } catch {
        /* poll will surface unreachable */
      }
      void poll();
    })();
  }, [valid, netflixId, poll, kickBody]);

  useEffect(() => {
    if (!valid) return;
    const t = setInterval(() => {
      void poll();
    }, 2500);
    return () => clearInterval(t);
  }, [valid, poll]);

  // release on unmount
  useEffect(() => {
    return () => {
      void fetch("/api/netflix/watch/release", { method: "POST" }).catch(() => {});
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  const live = status?.phase === "ready" && !!status.streamUrl && !streamError;

  // ---- the audio tap (webm/opus over socket.io → MSE) ----
  useEffect(() => {
    if (!live || !audioOn) return;
    if (typeof MediaSource === "undefined" || typeof io === "undefined") return;
    let disposed = false;
    const el = audioRef.current;
    if (!el) return;

    // MediaSource pipeline first — chunks can arrive any moment
    try {
      const ms = new MediaSource();
      mediaSourceRef.current = ms;
      el.src = URL.createObjectURL(ms);
      ms.addEventListener("sourceopen", () => {
        if (disposed) return;
        try {
          const sb = ms.addSourceBuffer('audio/webm; codecs="opus"');
          sb.mode = "sequence";
          sourceBufRef.current = sb;
          sb.addEventListener("updateend", pump);
          void el.play().catch(() => {/* autoplay guard — user can press play on the audio */});
        } catch {
          /* codec unsupported */
        }
      });
    } catch {
      /* MSE unavailable — video-only */
    }

    const socket = io("/", {
      path: "/nfsocket.io",
      transports: ["websocket"],
      query: { XTransformPort: "3030", room: "audio" },
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      // fresh tap for this viewer
      socket.emit("resync");
    });

    function pump() {
      const sb = sourceBufRef.current;
      if (!sb || sb.updating || queueRef.current.length === 0) return;
      const chunk = queueRef.current.shift()!;
      try {
        sb.appendBuffer(chunk);
      } catch {
        /* buffer full or closed — drop */
      }
    }

    socket.on("chunk", (buf: ArrayBuffer) => {
      if (disposed) return;
      setAudioOk(true);
      queueRef.current.push(buf);
      if (queueRef.current.length > 64) queueRef.current.splice(0, queueRef.current.length - 64);
      pump();
    });

    // latency convergence loop
    const sync = setInterval(() => {
      if (disposed || !el || el.readyState === 0) return;
      const buffered = el.buffered;
      if (buffered.length === 0) return;
      const end = buffered.end(buffered.length - 1);
      const ahead = end - el.currentTime;
      const target = Math.max(0.15, targetLatencyRef.current + offsetRef.current / 1000);
      if (ahead > target + 1.2) {
        el.currentTime = end - target;
        el.playbackRate = 1;
      } else if (ahead > target + 0.25) {
        el.playbackRate = 1.06;
      } else if (ahead < target - 0.25) {
        el.playbackRate = 0.94;
      } else {
        el.playbackRate = 1;
      }
      if (el.paused) void el.play().catch(() => {});
    }, 1500);

    return () => {
      disposed = true;
      clearInterval(sync);
      socket.disconnect();
      socketRef.current = null;
      try {
        sourceBufRef.current?.abort();
      } catch {/* noop */}
      mediaSourceRef.current = null;
      sourceBufRef.current = null;
      queueRef.current = [];
      setAudioOk(false);
    };
  }, [live, audioOn]);

  const offsetBy = (delta: number) => {
    offsetRef.current += delta;
    setAudioOffsetMs(offsetRef.current);
  };

  const restartSession = useCallback(async () => {
    setStreamError(false);
    await fetch("/api/netflix/watch/session/restart", { method: "POST" }).catch(() => {});
    await fetch("/api/netflix/watch/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(kickBody()),
    }).catch(() => {});
    void poll();
  }, [kickBody, poll]);

  const retryAuth = useCallback(async () => {
    setAuthRetryBusy(true);
    try {
      await fetch("/api/netflix/watch/retry-auth", { method: "POST" });
    } finally {
      setAuthRetryBusy(false);
    }
  }, []);

  const submitCookies = useCallback(async () => {
    setCookieBusy(true);
    setCookieResult(null);
    try {
      const res = await fetch("/api/netflix/watch/cookies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cookies: cookieInput.trim() }),
      });
      const out = (await res.json()) as { ok?: boolean; message?: string };
      setCookieResult(out.message ?? (out.ok ? "Connected." : "Failed."));
      if (out.ok) {
        setCookiePanelOpen(false);
        setCookieInput("");
        void poll();
      }
    } catch (e) {
      setCookieResult((e as Error).message);
    } finally {
      setCookieBusy(false);
    }
  }, [cookieInput, poll]);

  const toggleFullscreen = useCallback(() => {
    const root = document.getElementById("netflix-watch-root");
    if (!root) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.requestFullscreen().catch(() => {});
  }, []);

  const stepIndex = useMemo(() => {
    const i = PHASE_STEPS.findIndex((s) => s.key === status?.phase);
    return i === -1 ? 0 : i;
  }, [status?.phase]);

  if (!valid) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-black px-6 text-center text-white">
        <p className="text-lg font-semibold">Invalid Netflix title id.</p>
        <Link href="/netflix" className="mt-4 inline-flex h-10 items-center gap-2 rounded-md bg-[#e50914] px-5 text-sm font-semibold hover:bg-[#c4080f]">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to the Netflix hub
        </Link>
      </div>
    );
  }

  return (
    <div id="netflix-watch-root" className="flex h-full min-h-[560px] flex-col bg-black text-white" data-testid="netflix-watch-root">
      {/* top room chrome */}
      <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={title && !isLive ? `/netflix/t/${title.netflixId}` : "/netflix"}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-white/10 px-3 text-xs font-medium hover:bg-white/20"
            aria-label="Back to browse"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back
          </Link>
          <p className="truncate text-sm font-semibold" data-testid="netflix-watch-title">
            {isLive ? "Netflix Live — the real Netflix, right here" : title ? title.title : `Netflix #${netflixId}`}
            <span className="ml-2 rounded bg-[#e50914] px-1 py-0.5 text-[10px] font-black uppercase">Netflix</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {live && (
            <>
              <button
                type="button"
                onClick={() => setAudioOn((v) => !v)}
                className="flex h-9 items-center gap-1.5 rounded-md bg-white/10 px-3 text-xs font-medium hover:bg-white/20"
                aria-label={audioOn ? "Mute WebFlix audio" : "Unmute WebFlix audio"}
                data-testid="netflix-watch-audio-toggle"
              >
                {audioOn ? <Volume2 className="size-4" aria-hidden="true" /> : <VolumeX className="size-4" aria-hidden="true" />}
                <span className="hidden sm:inline">{audioOn ? "Sound" : "Muted"}</span>
              </button>
              <div className="hidden items-center gap-1 rounded-md bg-white/10 px-2 py-1 md:flex" aria-label="Audio sync adjustment">
                <Timer className="size-3.5 text-white/60" aria-hidden="true" />
                <button type="button" onClick={() => offsetBy(-250)} className="rounded p-1 hover:bg-white/15" aria-label="Audio 250ms earlier">
                  <Minus className="size-3.5" aria-hidden="true" />
                </button>
                <span className="w-14 text-center text-[11px] tabular-nums text-white/70">{audioOffsetMs >= 0 ? "+" : ""}{audioOffsetMs}ms</span>
                <button type="button" onClick={() => offsetBy(250)} className="rounded p-1 hover:bg-white/15" aria-label="Audio 250ms later">
                  <Plus className="size-3.5" aria-hidden="true" />
                </button>
              </div>
              <button
                type="button"
                onClick={toggleFullscreen}
                className="flex h-9 items-center gap-1.5 rounded-md bg-white/10 px-3 text-xs font-medium hover:bg-white/20"
                aria-label="Fullscreen"
              >
                <Maximize className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Fullscreen</span>
              </button>
            </>
          )}
          <a
            href={isLive ? "https://www.netflix.com/browse" : `https://www.netflix.com/watch/${netflixId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-9 items-center gap-1.5 rounded-md bg-white/10 px-3 text-xs font-medium hover:bg-white/20"
            aria-label="Open on netflix.com in a new tab"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            <span className="hidden lg:inline">netflix.com</span>
          </a>
        </div>
      </header>

      {/* the stage */}
      <main className="relative mx-4 mb-4 flex-1 overflow-hidden rounded-xl bg-[#0b0b0f] sm:mx-6" data-testid="netflix-watch-stage">
        {live || status?.phase === "auth-required" ? (
          status?.phase === "auth-required" ? (
            <>
              <iframe
                key={status?.streamUrl ?? "stream"}
                src={status?.streamUrl ?? undefined}
                title="Netflix sign-in window (secure cloud desktop)"
                className="absolute inset-0 h-full w-full border-0"
                allow="autoplay; fullscreen; encrypted-media; clipboard-read; clipboard-write"
                data-testid="netflix-watch-frame"
              />
              <div className="absolute inset-x-0 top-0 flex justify-center p-3" data-testid="netflix-watch-auth-overlay">
                <div className="w-full max-w-2xl space-y-3 rounded-xl border border-white/15 bg-black/85 p-5 text-center shadow-2xl backdrop-blur">
                  <KeyRound className="mx-auto size-6 text-[#e50914]" aria-hidden="true" />
                  <p className="text-base font-semibold">Connect your Netflix account</p>
                  <p className="text-sm leading-relaxed text-white/65">
                    Netflix&apos;s anti-bot wall blocks automated sign-ins from cloud networks —
                    so the reliable path is connecting your existing session (below). You can also
                    try signing in by hand inside the live window behind this panel, though the
                    wall usually stops that too.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCookiePanelOpen((v) => !v)}
                      className="flex h-10 items-center gap-2 rounded-md bg-[#e50914] px-4 text-sm font-semibold hover:bg-[#c4080f]"
                      data-testid="netflix-watch-cookie-connect"
                    >
                      <KeyRound className="size-4" aria-hidden="true" /> Connect with session cookies
                    </button>
                    <button
                      type="button"
                      onClick={() => void retryAuth()}
                      disabled={authRetryBusy}
                      className="flex h-10 items-center gap-2 rounded-md border border-white/20 px-4 text-sm font-medium hover:bg-white/5 disabled:opacity-60"
                      data-testid="netflix-watch-retry-auth"
                    >
                      {authRetryBusy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
                      Retry automatic sign-in
                    </button>
                  </div>
                  <p className="text-xs text-white/45" data-testid="netflix-watch-harvest-note">
                    Automatic sign-in runs periodically from residential networks — measured
                    reality (P45): Netflix issues session cookies but quarantines the login
                    before it activates, so every harvest result is strictly validated before
                    it&apos;s trusted. The cookie connect above is the guaranteed path.
                  </p>
                  {title && (
                    <p className="text-xs">
                      <Link
                        href={`/netflix/t/${title.netflixId}`}
                        className="text-white/60 underline underline-offset-2 hover:text-white"
                        data-testid="netflix-watch-trailer-link"
                      >
                        Meanwhile, watch the “{title.title}” trailer right now in WebFlix →
                      </Link>
                    </p>
                  )}
                  {cookiePanelOpen && (
                    <div className="mx-auto max-w-xl space-y-3 rounded-lg border border-white/15 bg-white/5 p-4 text-left" data-testid="netflix-watch-cookie-panel">
                      <label htmlFor="nf-cookie-input" className="text-xs font-semibold uppercase tracking-wide text-white/60">
                        Netflix session cookies
                      </label>
                      <ol className="space-y-1.5 text-xs leading-relaxed text-white/55" data-testid="netflix-watch-cookie-steps">
                        <li>
                          <span className="font-semibold text-white/80">1.</span> In a browser signed into Netflix, open DevTools
                          (<code className="rounded bg-black/40 px-1">F12</code>) → <b>Application</b> → <b>Cookies</b> →
                          <code className="mx-1 rounded bg-black/40 px-1">https://www.netflix.com</code>
                        </li>
                        <li>
                          <span className="font-semibold text-white/80">2.</span> Copy the values of
                          <code className="mx-1 rounded bg-black/40 px-1">NetflixId</code>and
                          <code className="mx-1 rounded bg-black/40 px-1">SecureNetflixId</code>— the two cookies Netflix checks
                        </li>
                        <li>
                          <span className="font-semibold text-white/80">3.</span> Paste them below as
                          <code className="mx-1 rounded bg-black/40 px-1">Name=Value</code>— one pair or the whole
                          <code className="mx-1 rounded bg-black/40 px-1">Cookie:</code>header both work
                        </li>
                      </ol>
                      <textarea
                        id="nf-cookie-input"
                        value={cookieInput}
                        onChange={(e) => setCookieInput(e.target.value)}
                        rows={4}
                        placeholder="NetflixId=v%3D3%26…; SecureNetflixId=…"
                        className="w-full rounded-md border border-white/15 bg-black/50 p-2 font-mono text-xs text-white placeholder:text-white/25"
                        data-testid="netflix-watch-cookie-input"
                      />
                      {cookieInput.trim().length > 0 && (
                        <p
                          className={`text-xs ${cookieLooksValid ? "text-emerald-400/90" : "text-amber-400/90"}`}
                          data-testid="netflix-watch-cookie-hint"
                        >
                          {cookieLooksValid
                            ? "Looks right — NetflixId detected. Connecting verifies it live against Netflix."
                            : "No NetflixId in that paste yet — Netflix needs it to restore your session."}
                        </p>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => void submitCookies()}
                          disabled={cookieBusy || cookieInput.trim().length === 0}
                          className="flex h-9 items-center gap-2 rounded-md bg-[#e50914] px-4 text-xs font-semibold hover:bg-[#c4080f] disabled:opacity-50"
                          data-testid="netflix-watch-cookie-submit"
                        >
                          {cookieBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                          Connect session
                        </button>
                        {cookieResult && <p className="text-xs text-white/70" data-testid="netflix-watch-cookie-result">{cookieResult}</p>}
                      </div>
                      <p className="text-[11px] leading-relaxed text-white/35">
                        The cookies stay on this server only — injected into your private cloud
                        desktop and cached for future sessions. Nothing is copied or replayed
                        anywhere else.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <iframe
                key={status?.streamUrl ?? "stream"}
                src={status?.streamUrl ?? undefined}
                title="Netflix playback window (secure cloud desktop)"
                className="absolute inset-0 h-full w-full border-0"
                allow="autoplay; fullscreen; encrypted-media; clipboard-read; clipboard-write"
                onError={() => setStreamError(true)}
                data-testid="netflix-watch-frame"
              />
              <audio ref={audioRef} autoPlay={audioOn} muted={!audioOn} className="hidden" />
              {!audioOk && audioOn && (
                <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[11px] text-white/70">
                  Connecting audio…
                </div>
              )}
            </>
          )
        ) : (
          <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-4 px-6 text-center">
            {status?.phase === "error" || status?.phase === "unreachable" ? (
              <>
                <p className="text-lg font-semibold">The playback session hit a snag.</p>
                <p className="max-w-md text-sm text-white/60">{status?.message ?? "The cloud desktop is not responding."}</p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => void restartSession()}
                    className="flex h-10 items-center gap-2 rounded-md bg-[#e50914] px-5 text-sm font-semibold hover:bg-[#c4080f]"
                  >
                    <RotateCcw className="size-4" aria-hidden="true" /> Restart the session
                  </button>
                  {status?.phase === "unreachable" && (
                    <a
                      href={`https://www.netflix.com/watch/${netflixId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-10 items-center gap-2 rounded-md border border-white/20 px-5 text-sm font-medium hover:bg-white/5"
                      data-testid="netflix-watch-unreachable-handoff"
                    >
                      <ExternalLink className="size-4" aria-hidden="true" />
                      Play on netflix.com instead
                    </a>
                  )}
                </div>
              </>
            ) : (
              <>
                <Loader2 className="size-8 animate-spin text-[#e50914]" aria-hidden="true" />
                <p className="text-lg font-semibold">Preparing Netflix…</p>
                <ol className="w-full max-w-xs space-y-2 text-left" data-testid="netflix-watch-progress">
                  {PHASE_STEPS.slice(0, 3).map((s, i) => {
                    const done = i < stepIndex;
                    const active = i === stepIndex;
                    return (
                      <li key={s.key} className={`flex items-center gap-2 text-sm ${done ? "text-white/45" : active ? "text-white" : "text-white/30"}`}>
                        {done ? (
                          <span className="flex size-4 items-center justify-center rounded-full bg-[#e50914] text-[9px] font-bold">✓</span>
                        ) : active ? (
                          <Loader2 className="size-4 animate-spin text-[#e50914]" aria-hidden="true" />
                        ) : (
                          <span className="size-4 rounded-full border border-white/25" />
                        )}
                        {s.label}
                      </li>
                    );
                  })}
                </ol>
                <p className="max-w-sm text-xs text-white/40">
                  First start takes about a minute — a fresh cloud desktop boots, Chrome opens
                  Netflix, and your session connects. Later plays start in seconds.
                </p>
              </>
            )}
          </div>
        )}
      </main>

      <footer className="px-4 pb-4 text-center text-[11px] leading-relaxed text-white/35 sm:px-6">
        Playback runs inside Netflix&apos;s own player on a private cloud desktop signed into your
        Netflix account — DRM stays intact, nothing is copied. Use of Netflix remains subject to
        the Netflix Terms of Service.
      </footer>
    </div>
  );
}
