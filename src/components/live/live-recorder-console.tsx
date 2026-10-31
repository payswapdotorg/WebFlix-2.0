"use client";

/**
 * WFX2-LIVE-PLATFORM-1 Phase 4 — Worker 4-c (UI lane): the host REC console
 * (work order §4H; ADR-0008's `host-capture` recording sink).
 *
 * The consent law (ADR-0008) shapes every word here: recording is a
 * HOST-ONLY control but a VISIBLE-TO-ALL fact — the idle copy states what
 * is captured and that every participant sees the REC indicator, and the
 * recording state repeats the note for guests on stage. A hidden indicator
 * would be a contract violation, not a UI detail.
 *
 * The upload law (frozen contracts, `replay/stop`): the console POSTs the
 * RAW bytes (never JSON) with the take's MIME as `Content-Type` and the
 * recorder wall-clock duration as `?durationMs=`. The bytes come from a
 * MediaRecorder the PARENT console owns — this file exports
 * `useProgramRecorder()` for exactly that, and the parent wires its `stop`
 * into this console's `getRecordingTake` prop. The console never invents a
 * take: when the supplier resolves null (nothing captured, no MediaRecorder
 * on this browser, or a double stop) it renders the honest error and
 * uploads nothing.
 *
 * Server-authoritative outcomes: the parent owns the `recording` state —
 * this console only reports what the server answered through
 * `onRecordingChange`. A 409 `replay-active` is a sync, not an error. If
 * `useProgramRecorder().unsupported` is true on this browser, the parent
 * should surface that BEFORE starting — a local sink cannot record where
 * MediaRecorder does not exist.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { JSX } from "react";
import { Circle, Loader2, Square, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { StartReplayInput } from "@/lib/live/types";

/** A finished local take: the raw bytes + the recorder wall-clock duration. */
export interface LiveRecordingTake {
  blob: Blob;
  durationMs: number;
}

/**
 * The frozen rate-limit copy (429 on replayStart/replayStop — the caller
 * fired recording changes too quickly; the honest fix is waiting).
 */
const RATE_LIMIT_COPY = "Slow down — too many recording changes.";

/** The honest copy when the take supplier has nothing to upload. */
const NO_TAKE_COPY = "The recorder had no take to save.";

/** Host-only mutations share one honest 403 copy. */
const FORBIDDEN_COPY = "Only the host can control recording.";

/** Codec candidates, first supported wins (the frozen pick order). */
const RECORDER_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

function pickRecorderMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const mime of RECORDER_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

export interface ProgramRecorder {
  /** Begin capturing the program stream (a no-op when unsupported/busy). */
  start: (stream: MediaStream) => void;
  /**
   * End the take and resolve with the bytes + wall-clock duration — or
   * `null` when nothing was captured (never started, already stopped, or
   * this browser has no MediaRecorder). The double-stop guard IS null.
   */
  stop: () => Promise<LiveRecordingTake | null>;
  /** True while MediaRecorder is capturing. */
  recording: boolean;
  /**
   * True when this browser cannot record at all (read AFTER mount —
   * hydration-safe: the server render and the first client render agree).
   */
  unsupported: boolean;
}

/** A static environment fact needs no subscription — only the snapshots. */
const subscribeNoop = (): (() => void) => () => {};

/**
 * The parent console's recorder. Owns ONLY the local MediaRecorder
 * lifecycle — the server-side `recording` fact stays with the room state
 * and is driven by the replay start/stop routes, never by this hook.
 */
export function useProgramRecorder(): ProgramRecorder {
  // Capability fact via useSyncExternalStore — hydration-safe: the server
  // snapshot answers "supported" so the first server and client renders
  // agree, and the client snapshot corrects after hydration (no effect,
  // no cascading setState).
  const mediaRecorderMissing = useSyncExternalStore(
    subscribeNoop,
    () => typeof MediaRecorder === "undefined",
    () => false,
  );
  // Capability failures discovered while STARTING (constructor throw, no
  // supported MIME) — set from event handlers only, never from an effect.
  const [startUnsupported, setStartUnsupported] = useState(false);
  const unsupported = mediaRecorderMissing || startUnsupported;
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number | null>(null);

  const start = useCallback((stream: MediaStream): void => {
    // Busy guard: a running recorder is never silently replaced.
    if (recorderRef.current && recorderRef.current.state !== "inactive") return;
    const mimeType = pickRecorderMimeType();
    if (mimeType === null) {
      setStartUnsupported(true);
      return;
    }
    try {
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      // Timeslice so chunks land continuously — a crashed tab still leaves
      // the earlier chunks collected, and memory never holds one giant part.
      recorder.start(1000);
      startedAtRef.current = Date.now(); // wall-clock, read in a callback only
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      recorderRef.current = null;
      startedAtRef.current = null;
      setRecording(false);
      setStartUnsupported(true);
    }
  }, []);

  const stop = useCallback((): Promise<LiveRecordingTake | null> => {
    const recorder = recorderRef.current;
    // Idle or already stopped → honest null (this IS the double-stop guard).
    if (recorder === null || recorder.state === "inactive") {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const finished = (): void => {
        const chunks = chunksRef.current;
        chunksRef.current = [];
        const startedAt = startedAtRef.current;
        startedAtRef.current = null;
        recorderRef.current = null;
        setRecording(false);
        resolve({
          blob: new Blob(chunks, { type: recorder.mimeType || "video/webm" }),
          durationMs: startedAt !== null ? Math.max(0, Date.now() - startedAt) : 0,
        });
      };
      recorder.onstop = finished;
      // An errored recorder still ends the take — partial bytes, honest duration.
      recorder.onerror = () => {
        try {
          recorder.stop();
        } catch {
          finished();
        }
      };
      try {
        recorder.stop();
      } catch {
        finished();
      }
    });
  }, []);

  return { start, stop, recording, unsupported };
}

export interface LiveRecorderConsoleProps {
  roomId: string;
  /** The server-truth recording fact (mirrors the stage DTO's `recording`). */
  recording: boolean;
  /** Called after the server accepts a start/stop — the parent owns state. */
  onRecordingChange?: (recording: boolean) => void;
  /**
   * The parent's take supplier — wire it to `useProgramRecorder().stop`.
   * Resolving null (or omitting the prop) renders the honest "no take"
   * error and uploads nothing.
   */
  getRecordingTake?: () => Promise<LiveRecordingTake | null>;
  className?: string;
}

/** 65 → "1:05", 3725 → "1:02:05". Elapsed time only ever grows. */
function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

function trimZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** 34567 → "33.8 KB", 5_242_880 → "5 MB" — the honest size line. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${trimZero((bytes / 1024).toFixed(1))} KB`;
  return `${trimZero((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

export function LiveRecorderConsole({
  roomId,
  recording,
  onRecordingChange,
  getRecordingTake,
  className,
}: LiveRecorderConsoleProps): JSX.Element {
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ sizeBytes: number | null } | null>(null);
  // Hydration-safe elapsed timer: 0 for both the server render and the first
  // client render; the interval only starts after mount (match-panel pattern).
  const [elapsedSec, setElapsedSec] = useState(0);
  // Recording flips reset the local timer in the RENDER phase (the React
  // documented prop-change adjustment — the use-api/match-panel pattern;
  // no synchronous setState inside effects).
  const [prevRecording, setPrevRecording] = useState(recording);
  if (recording !== prevRecording) {
    setPrevRecording(recording);
    if (!recording) setElapsedSec(0);
  }

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  async function startRecording(): Promise<void> {
    setError(null);
    setSaved(null);
    setStarting(true);
    try {
      const res = await fetch(`/api/live-rooms/${roomId}/replay/start`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({} satisfies StartReplayInput),
      });
      if (res.ok) {
        onRecordingChange?.(true);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (res.status === 409) {
        const marker = body.message ?? body.error ?? "";
        if (marker === "egress-not-configured") {
          setError("Server-side recording is not configured on this deployment.");
          return;
        }
        if (marker === "replay-active") {
          // The server says a take is already running — sync to that truth.
          onRecordingChange?.(true);
          return;
        }
      }
      if (res.status === 403) {
        setError(FORBIDDEN_COPY);
        return;
      }
      if (res.status === 429) {
        setError(RATE_LIMIT_COPY);
        return;
      }
      setError(
        body.message ??
          `Recording could not be started — the server answered ${res.status}.`,
      );
    } catch {
      setError(
        "Recording could not be started — the request failed before an answer arrived.",
      );
    } finally {
      setStarting(false);
    }
  }

  async function stopRecording(): Promise<void> {
    setError(null);
    setStopping(true);
    try {
      const take = getRecordingTake ? await getRecordingTake() : null;
      if (take === null) {
        // Nothing was captured (no MediaRecorder / double stop / idle) —
        // upload nothing, tell the truth. The take is not invented here.
        setError(NO_TAKE_COPY);
        return;
      }
      const url = `/api/live-rooms/${roomId}/replay/stop?durationMs=${Math.round(take.durationMs)}`;
      const res = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": take.blob.type || "video/webm" },
        body: take.blob,
      });
      if (res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          asset?: { sizeBytes?: number | null } | null;
        };
        setSaved({ sizeBytes: json.asset?.sizeBytes ?? null });
        onRecordingChange?.(false);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (res.status === 400) {
        // e.g. unsupported-media-type / recording-too-large — the server's words.
        setError(body.message ?? body.error ?? "The recording was rejected by the server.");
        return;
      }
      if (res.status === 403) {
        setError(FORBIDDEN_COPY);
        return;
      }
      if (res.status === 429) {
        setError(RATE_LIMIT_COPY);
        return;
      }
      setError(
        body.message ??
          `The replay could not be saved — the server answered ${res.status}.`,
      );
    } catch {
      setError(
        "The replay could not be saved — the request failed before an answer arrived.",
      );
    } finally {
      setStopping(false);
    }
  }

  return (
    <Card className={cn("min-w-0 gap-4", className)} data-testid="recorder-console">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Video className="size-4 text-muted-foreground" aria-hidden />
          Recording
        </CardTitle>
        {recording && (
          <Badge variant="destructive" className="animate-pulse" data-testid="rec-badge">
            REC
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {recording ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <p
                role="timer"
                data-testid="rec-elapsed"
                aria-label="Recording elapsed time"
                className="text-2xl font-bold tabular-nums text-foreground"
              >
                {formatElapsed(elapsedSec)}
              </p>
              <Button
                type="button"
                data-testid="recorder-stop"
                onClick={() => void stopRecording()}
                disabled={stopping}
              >
                {stopping ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Square className="size-3.5 fill-current" aria-hidden />
                )}
                {stopping ? "Saving…" : "Stop & save replay"}
              </Button>
            </div>
            <p
              role="note"
              data-testid="rec-consent-note"
              className="text-xs text-muted-foreground"
            >
              Guests on stage can see the REC indicator.
            </p>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              data-testid="recorder-start"
              onClick={() => void startRecording()}
              disabled={starting}
            >
              {starting ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Circle className="size-3 fill-red-500 text-red-500" aria-hidden />
              )}
              Start recording
            </Button>
            <p data-testid="recorder-honest-copy" className="text-xs text-muted-foreground">
              Records the program view in this console (camera, mic and rendered
              guests). Every participant sees the REC indicator.
            </p>
          </>
        )}

        {error !== null && (
          <p
            role="alert"
            data-testid="recorder-error"
            className="text-sm font-medium text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        )}
        {saved !== null && (
          <p
            role="status"
            data-testid="recorder-saved"
            className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-foreground"
          >
            Replay saved — it will appear when the stream ends.
            {saved.sizeBytes !== null && (
              <span className="text-muted-foreground"> · {formatBytes(saved.sizeBytes)}</span>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
