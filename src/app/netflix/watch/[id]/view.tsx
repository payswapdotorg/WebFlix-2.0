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
  Copy,
  Check,
  Puzzle,
} from "lucide-react";
import { useApi } from "@/hooks/use-api";
import { netflixWatchUrl, netflixBrowseUrl } from "@/lib/netflix/deeplink";
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
  // P51-AUDIT (B1): no `sandboxId` — the id addresses the sandbox's CDP relay
  // and must never reach the client (the broker stopped disclosing it; the
  // app proxy strips it defensively).
  streamUrl?: string | null;
  message?: string | null;
  videoId?: number | null;
  audioRunning?: boolean;
}

const PHASE_STEPS: Array<{ key: string; label: string }> = [
  { key: "provisioning", label: "Starting the secure cloud desktop" },
  { key: "stream-ready", label: "Opening Netflix in Chrome" },
  { key: "restoring-session", label: "Restoring your Netflix session" },
];

/** P46 — what the broker reports about the automatic sign-in bridge. */
interface BridgeStatus {
  lastBridgePushAt: number | null;
  lastBridgeDevice: string | null;
  candidatePending: boolean;
  lastRejection: { at: number; reason: string } | null;
}

interface AutoAuthInfo {
  token: string | null;
  bridge: BridgeStatus | null;
  message?: string;
}

/**
 * P47 — the automatic sign-in lane, extracted so BOTH places that need pairing
 * can render it: the auth-required overlay (the original P46 surface) and the
 * error state's collapsible panel — because the bridge's candidate law was
 * designed for exactly this: pair NOW, the candidate validates on the next
 * successful bootstrap (nothing unvalidated ever reaches playback).
 * All testids are the P46 ones — the auth-required DOM is unchanged.
 */
function AutoAuthLane(props: {
  autoAuth: AutoAuthInfo | null;
  origin: string;
  tokenCopied: boolean;
  rotateBusy: boolean;
  /** P52 — the route answered the house 401: NETFLIX_PAIRING_LOCKDOWN is on
   * and this visitor is signed out. An honest note replaces the token row. */
  locked?: boolean;
  onCopyToken: () => void;
  onRotateToken: () => void;
  statusLine: string;
}) {
  const { autoAuth, origin, tokenCopied, rotateBusy, locked, onCopyToken, onRotateToken, statusLine } = props;
  return (
    <div className="mx-auto max-w-xl space-y-3 rounded-lg border border-white/15 bg-white/5 p-4 text-left" data-testid="netflix-watch-autoauth-lane">
      {locked ? (
        <p
          className="rounded-md border border-white/10 bg-black/40 px-3 py-2 text-xs leading-relaxed text-white/70"
          data-testid="netflix-watch-autoauth-locked"
        >
          Automatic sign-in is{" "}
          <span className="font-semibold text-white/85">locked down</span> on this
          deployment — pairing is limited to signed-in viewers.{" "}
          <a href="/signin" className="text-white/85 underline underline-offset-2 hover:text-white">
            Sign in to WebFlix
          </a>{" "}
          and reopen this page to pair the bridge.
        </p>
      ) : (
        <>
      <ol className="space-y-2 text-xs leading-relaxed text-white/55">
        <li>
          <span className="font-semibold text-white/80">1.</span>{" "}
          <a href="/netflix-bridge.zip" download className="text-white/85 underline underline-offset-2 hover:text-white" data-testid="netflix-watch-autoauth-download">
            Download the WebFlix Bridge
          </a>{" "}
          and unzip it.
        </li>
        <li>
          <span className="font-semibold text-white/80">2.</span> In Chrome, open{" "}
          <code className="rounded bg-black/40 px-1">chrome://extensions</code>, enable <b>Developer mode</b>, click{" "}
          <b>Load unpacked</b> and pick the unzipped folder.
        </li>
        <li>
          <span className="font-semibold text-white/80">3.</span> Open the bridge&apos;s <b>Options</b>, paste{" "}
          <code className="rounded bg-black/40 px-1">{origin || "this WebFlix URL"}</code> as the WebFlix
          URL and this pairing token:
        </li>
      </ol>
      <div className="flex items-center gap-2">
        <code
          className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap rounded-md border border-white/15 bg-black/50 px-2 py-2 font-mono text-[11px] text-emerald-300"
          data-testid="netflix-watch-autoauth-token"
        >
          {autoAuth?.token ?? "loading…"}
        </code>
        <button
          type="button"
          onClick={onCopyToken}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-white/10 px-3 text-xs font-medium hover:bg-white/20"
          data-testid="netflix-watch-autoauth-copy"
        >
          {tokenCopied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
          {tokenCopied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={onRotateToken}
          disabled={rotateBusy}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-white/20 px-3 text-xs font-medium hover:bg-white/5 disabled:opacity-60"
          aria-label="Rotate the pairing token (old bridges stop working until re-paired)"
          data-testid="netflix-watch-autoauth-rotate"
        >
          {rotateBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-3.5" aria-hidden="true" />}
          Rotate
        </button>
      </div>
      <p className="text-xs leading-relaxed text-white/55">
        <span className="font-semibold text-white/80">4.</span> Then just keep using{" "}
        <code className="rounded bg-black/40 px-1">netflix.com</code> in that browser — the bridge ships
        your session the moment it sees one (and after every Netflix cookie rotation), and
        playback connects by itself.
      </p>
      <p
        className={`rounded-md border px-3 py-2 text-xs leading-relaxed ${
          autoAuth?.bridge?.lastRejection
            ? "border-amber-500/30 bg-amber-500/10 text-amber-200/90"
            : "border-white/10 bg-black/40 text-white/70"
        }`}
        data-testid="netflix-watch-autoauth-status"
      >
        {statusLine}
      </p>
      <p className="text-[11px] leading-relaxed text-white/35">
        The bridge talks only to this WebFlix server. Pushed sessions are validated
        against Netflix before they are ever trusted — an invalid push can never reach
        playback.
      </p>
        </>
      )}
    </div>
  );
}

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
  // P46 — the auth overlay has two lanes: the WebFlix Bridge (automatic,
  // primary) and the one-off cookie paste (manual, still first-class).
  const [authLane, setAuthLane] = useState<"auto" | "manual">("auto");
  const [autoAuth, setAutoAuth] = useState<AutoAuthInfo | null>(null);
  // P52 — the pairing route's lockdown rung: a 401 from /autoauth under
  // NETFLIX_PAIRING_LOCKDOWN means this signed-out visitor may not read the
  // token; the lane says so honestly instead of spinning on "loading…".
  const [pairingLocked, setPairingLocked] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [rotateBusy, setRotateBusy] = useState(false);
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
  // P51-AUDIT (A3): a restart that is still in flight must not be re-fired —
  // the broker tears the old desktop down ASYNC, and a second kick mid-teardown
  // can adopt the dying sandbox (the audit's destroy/bootstrap race).
  const [restartBusy, setRestartBusy] = useState(false);
  // P47 — the error state's collapsible automatic sign-in lane (pair now, the
  // candidate validates on the next successful bootstrap)
  const [errorAutoOpen, setErrorAutoOpen] = useState(false);

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
      // P51-AUDIT (A2): the broker-down 503 body IS the honest
      // `{phase:"unreachable"}` shape — throwing it away on !res.ok left the
      // lane on the eternal "Preparing…" spinner. A phase-bearing JSON body
      // is adopted whatever the status code.
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        return; // non-JSON and non-ok → nothing honest to adopt
      }
      if (!body || typeof body !== "object" || !("phase" in body)) return;
      const next = body as WatchSessionStatus;
      // change-guard: the poll ticks every 2.5s — re-render only on a real
      // phase/status change (keeps the room chrome steady under interaction)
      setStatus((prev) =>
        prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next
      );
    } catch {
      /* transient */
    }
  }, []);

  // P46 — pairing token + bridge push status for the automatic lane
  const fetchAutoAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/netflix/watch/autoauth", { cache: "no-store" });
      // P52 — the lockdown 401 IS the honest answer: stop polling, say why.
      if (res.status === 401) {
        setPairingLocked(true);
        return;
      }
      if (!res.ok) return;
      setPairingLocked(false);
      const next = (await res.json()) as AutoAuthInfo;
      setAutoAuth((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    // P47 — the pairing surface exists in TWO states now: the auth-required
    // overlay AND the error state's collapsible lane (pair now, validate on
    // the next bootstrap). Poll whenever either is on screen. P52 — never
    // poll a locked pairing route (the 401 is the answer, not a transient).
    const wanted = (status?.phase === "auth-required" || errorAutoOpen) && !pairingLocked;
    if (!wanted) return;
    // deferred (not synchronous in the effect body) — same pattern as the poll
    const first = setTimeout(() => void fetchAutoAuth(), 0);
    const t = setInterval(() => void fetchAutoAuth(), 5000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [status?.phase, errorAutoOpen, pairingLocked, fetchAutoAuth]);

  const copyToken = useCallback(async () => {
    if (!autoAuth?.token) return;
    try {
      await navigator.clipboard.writeText(autoAuth.token);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    } catch {
      /* clipboard blocked — the token stays selectable */
    }
  }, [autoAuth]);

  const rotateToken = useCallback(async () => {
    setRotateBusy(true);
    try {
      const res = await fetch("/api/netflix/watch/autoauth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "rotate" }),
      });
      // P52 — rotation under lockdown without a session: the honest 401 note
      if (res.status === 401) {
        setPairingLocked(true);
        return;
      }
      const out = (await res.json()) as { token?: string };
      if (out.token) {
        setAutoAuth((prev) => (prev ? { ...prev, token: out.token as string } : prev));
      }
    } catch {
      /* transient */
    } finally {
      setRotateBusy(false);
    }
  }, []);

  // the WebFlix URL the bridge options page wants — set from an external-system
  // callback (rAF), not synchronously in the effect body
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    const id = requestAnimationFrame(() => setOrigin(window.location.origin));
    return () => cancelAnimationFrame(id);
  }, []);

  const bridgeStatusLine = useMemo(() => {
    if (!autoAuth) return "Auto sign-in status unavailable right now.";
    const b = autoAuth.bridge;
    if (!b) return autoAuth.message ?? "No bridge information available yet.";
    if (b.candidatePending)
      return "Session received from your browser — it connects automatically on your next play.";
    if (b.lastRejection)
      return `Netflix rejected the last pushed session (${b.lastRejection.reason}) — make sure that browser is still signed in; the bridge re-pushes on its next rotation.`;
    if (b.lastBridgePushAt)
      return `Bridge last seen ${new Date(b.lastBridgePushAt).toLocaleTimeString()}${
        b.lastBridgeDevice ? ` · ${b.lastBridgeDevice}` : ""
      } — watching for changes.`;
    return "No bridge push seen yet — finish the pairing above, then open netflix.com in that browser.";
  }, [autoAuth]);

  // what we ask the broker for on entry/restart: the deep link for a title,
  // the browse lane for Netflix Live
  const kickBody = useCallback(
    () => (isLive ? { path: "/browse" } : { videoId: netflixId }),
    [isLive, netflixId]
  );

  // P49 — a play intent becomes a Continue Watching row (WebFlix-local,
  // honest-local; a failed write never blocks playback). The Live lane
  // records nothing — there is no single title to remember.
  const recordPlay = useCallback(() => {
    if (isLive || !Number.isInteger(netflixId) || netflixId <= 0) return;
    void fetch("/api/netflix/progress", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ netflixId }),
      keepalive: true,
    }).catch(() => {
      /* the rail is a memory, not a gate */
    });
  }, [isLive, netflixId]);

  // kick the session once, then poll until terminal-ish phases
  useEffect(() => {
    if (!valid || kickedRef.current) return;
    kickedRef.current = true;
    recordPlay();
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
  }, [valid, netflixId, poll, kickBody, recordPlay]);

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

  // P48 — the keyed snag: the broker is up but the deployment has no E2B key
  // (every desktop spawn fails with the SDK's "API key is required" shape).
  // That failure is an operator-setup problem with a known fix — the snag
  // becomes a setup wizard instead of a dead end.
  const keyedSnag = useMemo(() => {
    if (status?.phase !== "error") return false;
    return /E2B_API_KEY|API Keys tab|API key is required/i.test(status?.message ?? "");
  }, [status]);

  // ---- the audio tap (webm/opus over socket.io → MSE) ----
  // P51-AUDIT (A5): the pipeline lives for the whole `live` window — the mute
  // toggle no longer tears it down (muting is just `el.muted`), the object URL
  // is revoked on teardown, and socket death now downgrades `audioOk` instead
  // of leaving the "Connecting audio…" pill hiding a dead stream.
  useEffect(() => {
    if (!live) return;
    if (typeof MediaSource === "undefined") return;
    let disposed = false;
    const el = audioRef.current;
    if (!el) return;

    // MediaSource pipeline first — chunks can arrive any moment
    let objUrl: string | null = null;
    try {
      const ms = new MediaSource();
      mediaSourceRef.current = ms;
      objUrl = URL.createObjectURL(ms);
      el.src = objUrl;
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
    // a dead socket must never look like healthy audio
    const markDead = () => setAudioOk(false);
    socket.on("disconnect", markDead);
    socket.on("connect_error", markDead);

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
      if (objUrl) URL.revokeObjectURL(objUrl);
      setAudioOk(false);
    };
  }, [live]);

  // mute rides the element, not the pipeline (P51-AUDIT A5)
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = !audioOn;
  }, [audioOn, live]);

  const offsetBy = (delta: number) => {
    offsetRef.current += delta;
    setAudioOffsetMs(offsetRef.current);
  };

  const restartSession = useCallback(async () => {
    if (restartBusy) return; // P51-AUDIT (A3): one teardown in flight at a time
    setRestartBusy(true);
    setStreamError(false);
    recordPlay(); // a replay is still a play — the rail stays honest
    try {
      await fetch("/api/netflix/watch/session/restart", { method: "POST" }).catch(() => {});
      await fetch("/api/netflix/watch/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kickBody()),
      }).catch(() => {});
      await poll();
    } finally {
      setRestartBusy(false);
    }
  }, [kickBody, poll, recordPlay, restartBusy]);

  const retryAuth = useCallback(async () => {
    setAuthRetryBusy(true);
    try {
      const res = await fetch("/api/netflix/watch/retry-auth", { method: "POST" });
      if (!res.ok) {
        // P51-AUDIT (L7): a failed retry used to fail silently — surface it
        // by polling (the phase/message renders the honest state)
        void poll();
      }
    } catch {
      void poll();
    } finally {
      setAuthRetryBusy(false);
    }
  }, [poll]);

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
            href={isLive ? netflixBrowseUrl() : netflixWatchUrl(netflixId)}
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
                <div className="max-h-[92vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl border border-white/15 bg-black/85 p-5 text-center shadow-2xl backdrop-blur">
                  <KeyRound className="mx-auto size-6 text-[#e50914]" aria-hidden="true" />
                  <p className="text-base font-semibold">Connect your Netflix account</p>
                  <p className="text-sm leading-relaxed text-white/65">
                    Netflix&apos;s anti-bot wall blocks automated sign-ins from cloud networks —
                    so WebFlix connects <b>your existing session</b> instead. The bridge makes
                    that automatic: sign into Netflix once in your own browser and every session
                    — including future cookie rotations — reaches this window by itself.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2" role="tablist" aria-label="Sign-in method">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={authLane === "auto"}
                      onClick={() => { setAuthLane("auto"); setCookiePanelOpen(false); }}
                      className={`flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold ${authLane === "auto" ? "bg-[#e50914] hover:bg-[#c4080f]" : "border border-white/20 hover:bg-white/5"}`}
                      data-testid="netflix-watch-autoauth-tab"
                    >
                      <Puzzle className="size-4" aria-hidden="true" /> Automatic (bridge)
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={authLane === "manual"}
                      onClick={() => { setAuthLane("manual"); setCookiePanelOpen(true); }}
                      className={`flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold ${authLane === "manual" ? "bg-[#e50914] hover:bg-[#c4080f]" : "border border-white/20 hover:bg-white/5"}`}
                      data-testid="netflix-watch-cookie-connect"
                    >
                      <KeyRound className="size-4" aria-hidden="true" /> Paste cookies manually
                    </button>
                  </div>
                  {authLane === "auto" && !cookiePanelOpen && (
                    <AutoAuthLane
                      autoAuth={autoAuth}
                      origin={origin}
                      tokenCopied={tokenCopied}
                      rotateBusy={rotateBusy}
                      locked={pairingLocked}
                      onCopyToken={() => void copyToken()}
                      onRotateToken={() => void rotateToken()}
                      statusLine={bridgeStatusLine}
                    />
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
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => void retryAuth()}
                      disabled={authRetryBusy}
                      className="flex h-10 items-center gap-2 rounded-md border border-white/20 px-4 text-sm font-medium hover:bg-white/5 disabled:opacity-60"
                      data-testid="netflix-watch-retry-auth"
                    >
                      {authRetryBusy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
                      Retry harvest sign-in
                    </button>
                  </div>
                  <p className="text-xs text-white/45" data-testid="netflix-watch-harvest-note">
                    The background harvest (automated login from residential networks) stays armed but
                    slow — measured reality (P45): Netflix issues session cookies yet quarantines the
                    login before it activates. The bridge above never touches that wall because it is
                    simply you, signing in normally; the manual paste remains as the one-off fallback.
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
              keyedSnag ? (
                /* P48 — the keyed snag: an operator-setup wizard, not a dead end */
                <div className="w-full max-w-lg space-y-4" data-testid="netflix-watch-snag-keyed">
                  <p className="text-lg font-semibold">Playback needs an E2B key on this server.</p>
                  <p className="text-sm leading-relaxed text-white/60">
                    The playback broker is up, but this deployment has no <code className="rounded bg-black/40 px-1">E2B_API_KEY</code> —
                    the private cloud desktop that runs Netflix cannot start without it. Set the key on the
                    broker host, then restart the session; everything else (session cache, the bridge,
                    the pairing token) already works.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <a
                      href="https://e2b.dev/dashboard?tab=keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-10 items-center gap-2 rounded-md border border-white/20 px-5 text-sm font-medium hover:bg-white/5"
                      data-testid="netflix-watch-snag-e2b-link"
                    >
                      <ExternalLink className="size-4" aria-hidden="true" />
                      Get an E2B API key
                    </a>
                    <button
                      type="button"
                      onClick={() => void restartSession()}
                      disabled={restartBusy}
                      className="flex h-10 items-center gap-2 rounded-md bg-[#e50914] px-5 text-sm font-semibold hover:bg-[#c4080f] disabled:opacity-60"
                    >
                      {restartBusy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />} Retry after setting the key
                    </button>
                    <a
                      href={netflixWatchUrl(netflixId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-10 items-center gap-2 rounded-md border border-white/20 px-5 text-sm font-medium hover:bg-white/5"
                      data-testid="netflix-watch-unreachable-handoff"
                    >
                      <ExternalLink className="size-4" aria-hidden="true" />
                      Play on netflix.com instead
                    </a>
                  </div>
                  {/* P47 surface carried into the wizard — pairing works while
                      the desktop is down; the candidate validates on bootstrap */}
                  <div className="w-full">
                    <button
                      type="button"
                      onClick={() => setErrorAutoOpen((v) => !v)}
                      aria-expanded={errorAutoOpen}
                      className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-white/20 px-5 text-sm font-medium hover:bg-white/5"
                      data-testid="netflix-watch-error-autoauth-toggle"
                    >
                      <Puzzle className="size-4" aria-hidden="true" />
                      {errorAutoOpen ? "Hide automatic sign-in setup" : "Set up automatic sign-in while you wait"}
                    </button>
                    {errorAutoOpen && (
                      <div className="mt-3" data-testid="netflix-watch-error-autoauth">
                        <AutoAuthLane
                          autoAuth={autoAuth}
                          origin={origin}
                          tokenCopied={tokenCopied}
                          rotateBusy={rotateBusy}
                          locked={pairingLocked}
                          onCopyToken={() => void copyToken()}
                          onRotateToken={() => void rotateToken()}
                          statusLine={bridgeStatusLine}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
              <>
                <p className="text-lg font-semibold">The playback session hit a snag.</p>
                <p className="max-w-md text-sm text-white/60">{status?.message ?? "The cloud desktop is not responding."}</p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => void restartSession()}
                    disabled={restartBusy}
                    className="flex h-10 items-center gap-2 rounded-md bg-[#e50914] px-5 text-sm font-semibold hover:bg-[#c4080f] disabled:opacity-60"
                  >
                    {restartBusy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />} Restart the session
                  </button>
                  {/* P48 — the handoff rides EVERY failure state now (it was
                      unreachable-only): a dead desktop never blocks the movie */}
                  <a
                    href={netflixWatchUrl(netflixId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-10 items-center gap-2 rounded-md border border-white/20 px-5 text-sm font-medium hover:bg-white/5"
                    data-testid="netflix-watch-unreachable-handoff"
                  >
                    <ExternalLink className="size-4" aria-hidden="true" />
                    Play on netflix.com instead
                  </a>
                </div>
                {/* P47 — pair the bridge even while the desktop is down: the
                    candidate law stores the push and validates it on the next
                    successful bootstrap, so pairing is never wasted time. */}
                <div className="w-full max-w-md">
                  <button
                    type="button"
                    onClick={() => setErrorAutoOpen((v) => !v)}
                    aria-expanded={errorAutoOpen}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-white/20 px-5 text-sm font-medium hover:bg-white/5"
                    data-testid="netflix-watch-error-autoauth-toggle"
                  >
                    <Puzzle className="size-4" aria-hidden="true" />
                    {errorAutoOpen ? "Hide automatic sign-in setup" : "Set up automatic sign-in while you wait"}
                  </button>
                  {errorAutoOpen && (
                    <div className="mt-3" data-testid="netflix-watch-error-autoauth">
                      <AutoAuthLane
                        autoAuth={autoAuth}
                        origin={origin}
                        tokenCopied={tokenCopied}
                        rotateBusy={rotateBusy}
                        locked={pairingLocked}
                        onCopyToken={() => void copyToken()}
                        onRotateToken={() => void rotateToken()}
                        statusLine={bridgeStatusLine}
                      />
                    </div>
                  )}
                </div>
              </>
              )
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
