"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Eye,
  Loader2,
  Mic,
  MicOff,
  PlugZap,
  Radio,
  RefreshCw,
  Video,
  VideoOff,
  WifiOff,
  X,
} from "lucide-react";
import { ConnectionState, Track } from "livekit-client";
import {
  LiveKitRoom,
  TrackToggle,
  VideoTrack,
  useConnectionState,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type {
  LivePlaybackPlan,
  LiveRoomDto,
  LiveRoomPolicyDto,
  LiveSessionDto,
  PerformLiveModerationInput,
} from "@/lib/live/types";
import { LiveChatPanel } from "@/components/live/live-chat-panel";
import { LiveReactionRail } from "@/components/live/live-reaction-rail";
import { useLivePresence, useLiveStream } from "@/components/live/use-live-stream";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

/**
 * WFX2-LIVE-PLATFORM-1 (Worker 3) — the Creator Go Live preflight + console.
 *
 * The whole flow speaks ONLY the frozen contracts from @/lib/live/types and
 * the public /api/live-rooms REST shapes. Provider secrets never reach this
 * file: the server mints the short-lived playback plan (LivePlaybackPlan);
 * the renderer holds it in memory only. The LiveKit SDK here is the browser
 * client, not the server adapter.
 *
 * Phase 1 vertical slice (work order §8):
 *   preflight (title, visibility, honest device test) → Go Live →
 *   POST /api/live-rooms → POST /api/live-rooms/[id]/sessions →
 *   LiveKitRoom publish (camera + mic) → End live → POST /api/live-rooms/[id]/end.
 * Every failure is honest: nothing pretends a stream started, reconnected or
 * ended when it did not.
 */

const TITLE_MAX = 140;
const POLL_MS = 10_000;

/** The preflight device-permission ladder — one honest state at a time. */
type DevicePermission = "ask" | "testing" | "granted" | "denied" | "not-found";

/** The creator flow's top-level phase. */
type GoLivePhase = "preflight" | "live" | "ended";

/** The honest error payload a LIVE route answers with. */
interface ProviderFailure {
  code: string;
  message: string | null;
  /** Whether a room had already been created when this failure happened —
   * the copy must not claim "nothing was created" when one was. */
  roomSaved: boolean;
}

/** Error thrown by postLive carrying the LIVE error contract verbatim. */
interface LiveRequestFailure extends Error {
  code: string;
  detail: string | null;
}

/**
 * POST JSON to a LIVE route and surface the honest { error, message }
 * contract — the raw error code is the discriminator the UI branches on.
 */
async function postLive<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    const code = json.error ?? `HTTP ${res.status}`;
    const failure = new Error(code) as LiveRequestFailure;
    failure.code = code;
    failure.detail = json.message ?? null;
    throw failure;
  }
  return json as T;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatDuration(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt || !endedAt) return "—";
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function endReasonLabel(reason: LiveSessionDto["endReason"]): string {
  switch (reason) {
    case "host":
      return "You ended the stream";
    case "provider-webhook":
      return "The live provider reported the room finished";
    case "timeout":
      return "The session timed out";
    default:
      return "—";
  }
}

const DEVICE_KIND_LABEL: Record<string, string> = {
  videoinput: "camera",
  audioinput: "microphone",
  audiooutput: "speaker",
};

export default function GoLivePage() {
  const [phase, setPhase] = useState<GoLivePhase>("preflight");

  // Broadcast details.
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<"public" | "unlisted">("public");
  const [starting, setStarting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [providerFailure, setProviderFailure] = useState<ProviderFailure | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);

  // The room POST /api/live-rooms created, kept across a failed session
  // start so "try again" reuses the SAME room — no duplicate idle rooms.
  const [stagedRoom, setStagedRoom] = useState<LiveRoomDto | null>(null);

  // The live room + its playback plan (held in memory only; short-lived).
  const [room, setRoom] = useState<LiveRoomDto | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [playback, setPlayback] = useState<LivePlaybackPlan | null>(null);
  const [endFailure, setEndFailure] = useState<ProviderFailure | null>(null);

  // Device preflight state.
  const [permState, setPermState] = useState<DevicePermission>("ask");
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string>("");
  const [micId, setMicId] = useState<string>("");
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const trimmedTitle = title.trim();
  const titleValid = trimmedTitle.length >= 1 && trimmedTitle.length <= TITLE_MAX;

  // Attach the local preview MediaStream to the <video> element.
  useEffect(() => {
    const el = previewVideoRef.current;
    if (el && previewStream && el.srcObject !== previewStream) {
      el.srcObject = previewStream;
    }
  }, [previewStream]);

  // Release the preview's capture when the surface unmounts.
  useEffect(() => {
    return () => {
      previewStreamRef.current?.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
    };
  }, []);

  // Best-effort permission probe: Chromium/Safari 17+ expose camera/mic in
  // the Permissions API; Firefox rejects the query, which we catch and
  // ignore — the state simply stays "ask" until the explicit test runs.
  useEffect(() => {
    if (permState !== "ask") return;
    const permissions = navigator.permissions;
    if (!permissions?.query) return;
    let cancelled = false;
    void Promise.all([
      permissions.query({ name: "camera" as PermissionName }).catch(() => null),
      permissions.query({ name: "microphone" as PermissionName }).catch(() => null),
    ])
      .then(([cam, mic]) => {
        if (cancelled) return;
        if ((cam && cam.state === "denied") || (mic && mic.state === "denied")) {
          setPermState("denied");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [permState]);

  /**
   * The explicit device test — the ONLY place camera/mic access is requested
   * before going live (consent law: browsers are asked after a clear click,
   * never on page load). Switching devices while granted restarts the
   * preview with the newly chosen deviceId.
   */
  const startDeviceTest = useCallback(
    async (nextCameraId?: string, nextMicId?: string) => {
      setDeviceError(null);
      setPermState((cur) => (cur === "granted" ? cur : "testing"));
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: nextCameraId ? { deviceId: { exact: nextCameraId } } : true,
          audio: nextMicId ? { deviceId: { exact: nextMicId } } : true,
        });
        // Success: retire the previous preview AFTER the new capture exists.
        previewStreamRef.current?.getTracks().forEach((t) => t.stop());
        previewStreamRef.current = stream;
        setPreviewStream(stream);
        const devices = await navigator.mediaDevices.enumerateDevices();
        setCameras(devices.filter((d) => d.kind === "videoinput"));
        setMics(devices.filter((d) => d.kind === "audioinput"));
        const usedCam = stream.getVideoTracks()[0]?.getSettings().deviceId;
        const usedMic = stream.getAudioTracks()[0]?.getSettings().deviceId;
        setCameraId(usedCam ?? nextCameraId ?? "");
        setMicId(usedMic ?? nextMicId ?? "");
        setPermState("granted");
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "UnknownError";
        const stillStreaming =
          previewStreamRef.current?.getTracks().some((t) => t.readyState === "live") ?? false;
        if (stillStreaming) {
          // A device SWITCH failed; the previous preview still runs — stay
          // in the granted state and say exactly what happened.
          setDeviceError(
            `Switching to that ${name === "OverconstrainedError" ? "device" : "device pair"} failed (${name}). Still previewing the previous devices.`,
          );
          return;
        }
        if (name === "NotAllowedError" || name === "SecurityError") {
          setPermState("denied");
        } else if (name === "NotFoundError") {
          setPermState("not-found");
        } else if (name === "NotReadableError") {
          setPermState("ask");
          setDeviceError(
            "Your camera or microphone is busy — another app or browser window is using it. Close it and test again.",
          );
        } else if (name === "OverconstrainedError") {
          setPermState("ask");
          setDeviceError(
            "That exact device is no longer available. Pick another below (or System default) and test again.",
          );
        } else {
          setPermState("ask");
          setDeviceError(
            err instanceof Error
              ? `The device test failed: ${err.message}`
              : "The device test failed for an unknown reason.",
          );
        }
      }
    },
    [],
  );

  /** Go Live: create the room, then start the session on it (two honest POSTs). */
  const goLive = useCallback(async () => {
    if (!titleValid || starting) return;
    setStarting(true);
    setFormError(null);
    setProviderFailure(null);
    setSignInRequired(false);
    let working = stagedRoom;
    try {
      if (!working) {
        const created = await postLive<{ room: LiveRoomDto }>("/api/live-rooms", {
          title: trimmedTitle,
          visibility,
        });
        working = created.room;
        setStagedRoom(created.room);
      }
      const started = await postLive<{ room: LiveRoomDto; playback: LivePlaybackPlan }>(
        `/api/live-rooms/${working.id}/sessions`,
        {},
      );
      // The private preview capture is over — the room publishes its own.
      previewStreamRef.current?.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
      setPreviewStream(null);
      setPermState("ask");
      setRoom(started.room);
      setRoomId(started.room.id);
      setPlayback(started.playback);
      setPhase("live");
    } catch (err) {
      // Honesty detail: the failure may land AFTER the room was created
      // (e.g. the session cookie expired between the two POSTs) — the copy
      // branches on roomSaved so it never claims the wrong thing.
      const roomSaved = working !== null;
      const failure = err as LiveRequestFailure;
      switch (failure.code) {
        case "unauthenticated":
          setSignInRequired(true);
          break;
        case "provider-not-configured":
        case "provider-failed":
          setProviderFailure({ code: failure.code, message: failure.detail ?? null, roomSaved });
          break;
        case "invalid":
          setFormError("Add a title between 1 and 140 characters, then try again.");
          break;
        case "rate-limited":
          setFormError("Too many Go Live attempts right now — wait a moment and try again.");
          break;
        case "conflict":
          setFormError(
            "This room already has an active live session. Reload the page to re-attach to it.",
          );
          break;
        case "not-found":
          setFormError("That room no longer exists. Start again with a fresh Go Live.");
          setStagedRoom(null);
          break;
        default:
          setFormError(
            `Going live failed (${failure.code}). No stream is running — try again.`,
          );
      }
    } finally {
      setStarting(false);
    }
  }, [titleValid, starting, trimmedTitle, visibility, stagedRoom]);

  /**
   * End live: POST /api/live-rooms/[id]/end. The server destroys the provider
   * room FIRST — a 502 here means the stream is genuinely still live, so the
   * console stays up and the failure alert offers "Retry end" (no fake end).
   */
  const endLive = useCallback(async (): Promise<ProviderFailure | null> => {
    if (!roomId) {
      return {
        code: "unknown",
        message: "No live room is attached to this console.",
        roomSaved: false,
      };
    }
    setEndFailure(null);
    try {
      const ended = await postLive<{ room: LiveRoomDto }>(
        `/api/live-rooms/${roomId}/end`,
        {},
      );
      setRoom(ended.room);
      setPlayback(null);
      setPhase("ended");
      return null;
    } catch (err) {
      const failure = err as LiveRequestFailure;
      const f: ProviderFailure = {
        code: failure.code,
        message:
          failure.detail ??
          (failure.code === "provider-failed"
            ? "The live provider could not be reached to destroy the room."
            : null),
        roomSaved: true,
      };
      setEndFailure(f);
      return f;
    }
  }, [roomId]);

  // Fresh approximate viewer count every 10s while live. The count is
  // approximate by contract (provider webhooks reconcile joins/leaves into
  // the DB; the API serves the fresh total). A transient poll failure keeps
  // the last known count — it never invents one.
  useEffect(() => {
    if (phase !== "live" || !roomId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/live-rooms/${roomId}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { room: LiveRoomDto };
        if (cancelled) return;
        setRoom(data.room);
        if (data.room.status === "ended") {
          // The provider webhook ended the room out-of-band (kill switch or
          // provider-side close) — surface the honest ended state instead of
          // pretending the console is still publishing.
          setPlayback(null);
          setPhase("ended");
        }
      } catch {
        // network blip — the next tick retries
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [phase, roomId]);

  /** "Start another live" — full reset to a clean preflight. */
  const resetAll = useCallback(() => {
    setPhase("preflight");
    setTitle("");
    setVisibility("public");
    setStagedRoom(null);
    setRoom(null);
    setRoomId(null);
    setPlayback(null);
    setFormError(null);
    setProviderFailure(null);
    setEndFailure(null);
    setSignInRequired(false);
    setStarting(false);
  }, []);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
          <span
            className="flex size-7 items-center justify-center rounded-full bg-yt-red text-white"
            aria-hidden="true"
          >
            <Radio className="size-4" />
          </span>
          Go live
        </h1>
        <p className="text-sm text-muted-foreground">
          Broadcast your camera and microphone straight from this browser to your
          WebFlix room.
        </p>
      </header>

      {phase === "ended" && room ? (
        <EndedSummaryCard room={room} onStartAnother={resetAll} />
      ) : phase === "live" && room && playback ? (
        <LiveConsole
          room={room}
          playback={playback}
          endFailure={endFailure}
          onEnd={endLive}
          cameraId={cameraId}
          micId={micId}
        />
      ) : signInRequired ? (
        <SignInRequiredCard roomSaved={stagedRoom !== null} />
      ) : (
        <PreflightCard
          title={title}
          onTitleChange={setTitle}
          visibility={visibility}
          onVisibilityChange={setVisibility}
          starting={starting}
          formError={formError}
          providerFailure={providerFailure}
          onRetryStart={goLive}
          permState={permState}
          deviceError={deviceError}
          cameras={cameras}
          mics={mics}
          cameraId={cameraId}
          micId={micId}
          previewVideoRef={previewVideoRef}
          onDeviceTest={startDeviceTest}
          onGoLive={goLive}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Preflight                                                           */
/* ------------------------------------------------------------------ */

interface PreflightCardProps {
  title: string;
  onTitleChange: (v: string) => void;
  visibility: "public" | "unlisted";
  onVisibilityChange: (v: "public" | "unlisted") => void;
  starting: boolean;
  formError: string | null;
  providerFailure: ProviderFailure | null;
  onRetryStart: () => Promise<void>;
  permState: DevicePermission;
  deviceError: string | null;
  cameras: MediaDeviceInfo[];
  mics: MediaDeviceInfo[];
  cameraId: string;
  micId: string;
  previewVideoRef: React.RefObject<HTMLVideoElement | null>;
  onDeviceTest: (nextCameraId?: string, nextMicId?: string) => Promise<void>;
  onGoLive: () => Promise<void>;
}

function PreflightCard(props: PreflightCardProps) {
  const {
    title,
    onTitleChange,
    visibility,
    onVisibilityChange,
    starting,
    formError,
    providerFailure,
    onRetryStart,
    permState,
    deviceError,
    cameras,
    mics,
    cameraId,
    micId,
    previewVideoRef,
    onDeviceTest,
    onGoLive,
  } = props;

  const trimmedLength = title.trim().length;
  const titleValid = trimmedLength >= 1 && trimmedLength <= TITLE_MAX;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Broadcast details</CardTitle>
        <CardDescription>
          What you set here is what viewers see. Devices are requested only when
          you test them — and again when you actually go live.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="go-live-title">Title</Label>
          <Input
            id="go-live-title"
            data-testid="go-live-title-input"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="What are you streaming today?"
            maxLength={TITLE_MAX + 20}
            aria-invalid={!titleValid}
            aria-describedby="go-live-title-help"
          />
          <p
            id="go-live-title-help"
            className={`text-xs ${titleValid ? "text-muted-foreground" : "text-destructive"}`}
          >
            {trimmedLength}/{TITLE_MAX} characters — a title is required before
            you can go live.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="go-live-visibility">Visibility</Label>
          <Select
            value={visibility}
            onValueChange={(value) => onVisibilityChange(value as "public" | "unlisted")}
          >
            <SelectTrigger id="go-live-visibility" className="w-full sm:w-72">
              <SelectValue placeholder="Choose visibility" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="public">
                Public — listed in Live discovery while you stream
              </SelectItem>
              <SelectItem value="unlisted">
                Unlisted — only people with the room link can watch
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* Device test — honest permission ladder: ask / testing / granted / denied / not-found. */}
        <div className="space-y-4">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Camera className="size-4" aria-hidden="true" />
              Camera &amp; microphone test
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              The stream publishes exactly what you approve here.{" "}
              <span className="font-medium text-foreground">
                Only you can see this preview.
              </span>
            </p>
          </div>

          {permState === "ask" && !deviceError && (
            <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-4">
              <Button variant="outline" onClick={() => void onDeviceTest()}>
                <Camera className="size-4" aria-hidden="true" />
                Test camera &amp; mic
              </Button>
              <p className="text-xs text-muted-foreground">
                Clicking test asks your browser for permission. WebFlix never
                requests your devices on page load.
              </p>
            </div>
          )}

          {permState === "testing" && (
            <p className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Requesting your camera and microphone — approve the browser prompt
              to continue.
            </p>
          )}

          {permState === "denied" && (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>Camera and microphone are blocked</AlertTitle>
              <AlertDescription>
                Your browser is blocking WebFlix from using them. To unblock:
                open your browser&apos;s site settings (the lock or tune icon in
                the address bar), set <strong>Camera</strong> and{" "}
                <strong>Microphone</strong> to &quot;Allow&quot; for this site,
                then reload this page and run the test again. Nothing has been
                requested from the live provider yet — no stream can start while
                access is blocked.
              </AlertDescription>
            </Alert>
          )}

          {permState === "not-found" && (
            <Alert>
              <VideoOff aria-hidden="true" />
              <AlertTitle>No camera or microphone found</AlertTitle>
              <AlertDescription>
                We couldn&apos;t find a usable device. Connect a camera or
                microphone, make sure no other app has exclusive use of it, and
                run the test again.
              </AlertDescription>
            </Alert>
          )}

          {deviceError && (
            <p role="alert" className="text-sm text-destructive">
              {deviceError}
            </p>
          )}

          {(permState === "granted" || permState === "testing") && (
            <div className="space-y-4">
              <div className="relative aspect-video w-full overflow-hidden rounded-xl border bg-black">
                <video
                  ref={previewVideoRef}
                  data-testid="go-live-preview-video"
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />
                <span className="absolute bottom-2 left-2 rounded-sm bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
                  Only you can see this preview
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="go-live-camera">Camera</Label>
                  <Select
                    value={cameraId || "default"}
                    onValueChange={(value) =>
                      void onDeviceTest(
                        value === "default" ? undefined : value,
                        micId || undefined,
                      )
                    }
                  >
                    <SelectTrigger id="go-live-camera" className="w-full">
                      <SelectValue placeholder="Select camera" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">System default</SelectItem>
                      {cameras
                        .filter((d) => d.deviceId)
                        .map((d, i) => (
                          <SelectItem key={d.deviceId} value={d.deviceId}>
                            {d.label || `Camera ${i + 1}`}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="go-live-mic">Microphone</Label>
                  <Select
                    value={micId || "default"}
                    onValueChange={(value) =>
                      void onDeviceTest(
                        cameraId || undefined,
                        value === "default" ? undefined : value,
                      )
                    }
                  >
                    <SelectTrigger id="go-live-mic" className="w-full">
                      <SelectValue placeholder="Select microphone" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">System default</SelectItem>
                      {mics
                        .filter((d) => d.deviceId)
                        .map((d, i) => (
                          <SelectItem key={d.deviceId} value={d.deviceId}>
                            {d.label || `Microphone ${i + 1}`}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Switching devices restarts the preview with the newly chosen
                device. Permission state: granted.
              </p>
            </div>
          )}
        </div>

        {formError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {formError}
          </p>
        )}

        {providerFailure && (
          <Alert data-testid="live-provider-error" variant="destructive">
            <PlugZap aria-hidden="true" />
            <AlertTitle>
              {providerFailure.code === "provider-not-configured"
                ? "Live provider not connected"
                : "The live provider failed to start your stream"}
            </AlertTitle>
            <AlertDescription>
              {providerFailure.code === "provider-not-configured"
                ? providerFailure.roomSaved
                  ? "This deployment hasn't connected its live provider yet, so broadcasting is unavailable here. Your room was saved but no stream was started — nothing is live right now."
                  : "This deployment hasn't connected its live provider yet, so broadcasting is unavailable here. Nothing was created and no stream is running."
                : providerFailure.roomSaved
                  ? `${providerFailure.message ?? "The provider rejected the start request."} No stream is running. You can retry — the same room is reused, no duplicate is created.`
                  : `${providerFailure.message ?? "The provider rejected the start request."} No room was created and no stream is running — try again.`}
            </AlertDescription>
            <div className="mt-3">
              <Button
                size="sm"
                variant="outline"
                disabled={starting}
                onClick={() => void onRetryStart()}
              >
                {starting ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="size-4" aria-hidden="true" />
                )}
                Try starting again
              </Button>
            </div>
          </Alert>
        )}

        <div className="flex flex-col items-start gap-2 border-t pt-4">
          <Button
            data-testid="go-live-submit"
            variant="destructive"
            size="lg"
            disabled={!titleValid || starting}
            onClick={() => void onGoLive()}
          >
            {starting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Radio className="size-4" aria-hidden="true" />
            )}
            {starting ? "Starting your stream…" : "Go live"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Going live publishes from this browser. A public room appears in Live
            discovery while you stream; you can end it any time.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/** 401 state — the copy is honest about whether a room got created. */
function SignInRequiredCard({ roomSaved }: { roomSaved: boolean }) {
  return (
    <Card data-testid="live-signin-required" className="mx-auto w-full max-w-md text-center">
      <CardHeader>
        <CardTitle className="flex items-center justify-center gap-2">
          <AlertTriangle className="size-5 text-amber-500" aria-hidden="true" />
          Sign in to go live
        </CardTitle>
        <CardDescription>
          {roomSaved
            ? "Your session ended mid-request: the room was saved, but the broadcast could not start. Sign in, then try again — the same room will be reused."
            : "Broadcasting needs a WebFlix account. Your request was not processed and nothing was created — sign in, then come back to this page."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <Button asChild>
          <Link href="/signin">Sign in</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Live console                                                        */
/* ------------------------------------------------------------------ */

interface LiveConsoleProps {
  room: LiveRoomDto;
  playback: LivePlaybackPlan;
  endFailure: ProviderFailure | null;
  onEnd: () => Promise<ProviderFailure | null>;
  cameraId: string;
  micId: string;
}

function LiveConsole({ room, playback, endFailure, onEnd, cameraId, micId }: LiveConsoleProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [deviceFailure, setDeviceFailure] = useState<string | null>(null);
  // Set from the LiveKitRoom's own onConnected EVENT callback (never during
  // render) so the connection UI can tell "never connected" from "lost".
  const [everConnected, setEverConnected] = useState(false);

  // ── Phase 2 interaction (the console is the HOST surface) ──
  // ONE page stream feeds the chat panel + the room-wide reaction total;
  // the heartbeat keeps the host row inside the freshness window.
  const stream = useLiveStream(room.id);
  useLivePresence(room.id, true);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [slowModeSeconds, setSlowModeSeconds] = useState(0);
  const hostPolicy: LiveRoomPolicyDto = {
    chatEnabled,
    reactionsEnabled: true,
    slowModeSeconds,
    guestsEnabled: true,
    giftsEnabled: true,
    actorRole: "host",
    canChat: true,
    chatBlockedReason: null,
  };

  const runEnd = useCallback(async () => {
    setEnding(true);
    const failure = await onEnd();
    setEnding(false);
    if (!failure) {
      // On success the parent flips the phase and this console unmounts.
      setConfirmOpen(false);
    }
    // On failure the console stays mounted — the stream is genuinely still
    // live and the honest failure alert offers the retry.
  }, [onEnd]);

  return (
    <LiveKitRoom
      data-testid="live-console"
      className="space-y-4"
      serverUrl={playback.url}
      token={playback.token}
      connect
      audio={micId ? { deviceId: { exact: micId } } : true}
      video={cameraId ? { deviceId: { exact: cameraId } } : true}
      options={{ adaptiveStream: true, dynacast: true }}
      onError={(error) => setConnectError(error.message || "unknown error")}
      onConnected={() => setEverConnected(true)}
      onMediaDeviceFailure={(failure, kind) =>
        setDeviceFailure(
          kind
            ? `${failure ?? "unknown failure"} on your ${DEVICE_KIND_LABEL[kind] ?? kind}`
            : "unknown device failure",
        )
      }
    >
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-lg">{room.title}</CardTitle>
            <span className="flex items-center gap-1.5 rounded-full bg-yt-red/10 px-2.5 py-0.5 text-xs font-bold uppercase text-yt-red">
              <span className="size-1.5 animate-pulse rounded-full bg-yt-red" aria-hidden="true" />
              Live
            </span>
            <Badge variant="outline">{room.visibility}</Badge>
          </div>
          <CardDescription className="flex flex-wrap items-center gap-4">
            <span>Host: @{room.hostHandle}</span>
            <span className="flex items-center gap-1.5">
              <Eye className="size-4" aria-hidden="true" />
              approx. {room.viewerCount} watching
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <ConnectionPill everConnected={everConnected} />
          <div className="flex items-center gap-2">
            <TrackToggle
              source={Track.Source.Microphone}
              showIcon={false}
              className="group inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium shadow-xs hover:bg-accent data-[state=off]:text-muted-foreground"
            >
              <Mic className="size-4 group-data-[state=off]:hidden" aria-hidden="true" />
              <MicOff className="hidden size-4 group-data-[state=off]:block" aria-hidden="true" />
              Mic
            </TrackToggle>
            <TrackToggle
              source={Track.Source.Camera}
              showIcon={false}
              className="group inline-flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium shadow-xs hover:bg-accent data-[state=off]:text-muted-foreground"
            >
              <Video className="size-4 group-data-[state=off]:hidden" aria-hidden="true" />
              <VideoOff
                className="hidden size-4 group-data-[state=off]:block"
                aria-hidden="true"
              />
              Camera
            </TrackToggle>
          </div>
        </CardContent>
      </Card>

      <ConnectionStatus url={playback.url} token={playback.token} everConnected={everConnected} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LocalCameraTile />
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Publishing</CardTitle>
            <CardDescription>
              Your camera and microphone stream from this browser.{" "}
              {room.visibility === "public"
                ? "This public room appears in Live discovery while you stream."
                : "This unlisted room is reachable only by its link."}{" "}
              The viewer count is approximate and refreshes every 10 seconds.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              data-testid="live-console-end"
              variant="destructive"
              className="w-full"
              onClick={() => setConfirmOpen(true)}
              disabled={ending}
            >
              End live
            </Button>
            <p className="text-xs text-muted-foreground">
              You&apos;ll be asked to confirm — ending disconnects viewers
              immediately and can&apos;t be undone.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Phase 2: the room interaction surface (chat + moderation) ── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <LiveChatPanel
          roomId={room.id}
          sessionLive
          policy={hostPolicy}
          canModerate
          signedIn
          stream={stream}
        />
        <div className="space-y-4">
          <LiveReactionRail
            roomId={room.id}
            sessionLive
            reactionsEnabled
            signedIn
            streamReactionTotal={stream.reactionTotal?.total ?? null}
          />
          <HostPolicyControls
            roomId={room.id}
            chatEnabled={chatEnabled}
            slowModeSeconds={slowModeSeconds}
            onChatEnabled={setChatEnabled}
            onSlowMode={setSlowModeSeconds}
          />
        </div>
      </div>

      {connectError && (
        <Alert variant="destructive">
          <WifiOff aria-hidden="true" />
          <AlertTitle>Could not reach the live provider</AlertTitle>
          <AlertDescription>{connectError}</AlertDescription>
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={() => setConnectError(null)}>
              <X className="size-4" aria-hidden="true" />
              Dismiss
            </Button>
          </div>
        </Alert>
      )}

      {deviceFailure && (
        <Alert variant="destructive">
          <Camera aria-hidden="true" />
          <AlertTitle>Your device stopped mid-stream</AlertTitle>
          <AlertDescription>
            The browser reported: {deviceFailure}. Viewers see a frozen tile while
            the track is down; check the device connection or permissions.
          </AlertDescription>
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={() => setDeviceFailure(null)}>
              <X className="size-4" aria-hidden="true" />
              Dismiss
            </Button>
          </div>
        </Alert>
      )}

      {endFailure && (
        <Alert data-testid="live-provider-error" variant="destructive">
          <PlugZap aria-hidden="true" />
          <AlertTitle>Ending the stream failed</AlertTitle>
          <AlertDescription>
            {endFailure.message ??
              "The live provider did not confirm the end request."}{" "}
            WebFlix did NOT pretend the stream ended — it is still live, and
            viewers may still be watching. Retry the end request.
          </AlertDescription>
          <div className="mt-3">
            <Button size="sm" variant="destructive" disabled={ending} onClick={() => void runEnd()}>
              {ending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-4" aria-hidden="true" />
              )}
              Retry end
            </Button>
          </div>
        </Alert>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End this live stream?</DialogTitle>
            <DialogDescription>
              Viewers disconnect immediately and the room is marked ended. This
              can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={ending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void runEnd()} disabled={ending}>
              {ending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              End live
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </LiveKitRoom>
  );
}

/** Small inline connection state for the header row. */
function ConnectionPill({ everConnected }: { everConnected: boolean }) {
  const state = useConnectionState();

  if (state === ConnectionState.Connected) {
    return (
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
        Connected
      </span>
    );
  }
  if (
    state === ConnectionState.Reconnecting ||
    state === ConnectionState.SignalReconnecting
  ) {
    return (
      <span className="flex items-center gap-2 text-sm font-medium text-amber-500">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        Reconnecting…
      </span>
    );
  }
  // Before the first connect lands, LiveKit's state starts at Disconnected —
  // show the honest "connecting" pill instead of a false "lost" claim.
  return (
    <span className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      {state === ConnectionState.Connecting || !everConnected
        ? "Connecting…"
        : "Disconnected"}
    </span>
  );
}

/**
 * The big honest connection banners. Reconnecting gets the amber
 * live-console-reconnecting banner; disconnected (after a real connection)
 * gets "connection lost" with a working retry. The LiveKit token is
 * short-lived, so a late retry can honestly fail — the error is shown.
 */
function ConnectionStatus({
  url,
  token,
  everConnected,
}: {
  url: string;
  token: string;
  everConnected: boolean;
}) {
  const state = useConnectionState();
  const room = useRoomContext();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  if (
    state === ConnectionState.Reconnecting ||
    state === ConnectionState.SignalReconnecting
  ) {
    return (
      <Alert
        data-testid="live-console-reconnecting"
        role="status"
        className="border-amber-500/40 bg-amber-500/10 text-amber-200 [&>svg]:text-amber-500"
      >
        <RefreshCw className="animate-spin" aria-hidden="true" />
        <AlertTitle>Reconnecting…</AlertTitle>
        <AlertDescription>
          Your camera keeps publishing while WebFlix restores the link. If this
          banner stays up, check your network — viewers see a frozen tile until
          the connection returns.
        </AlertDescription>
      </Alert>
    );
  }

  if (state === ConnectionState.Disconnected && everConnected) {
    return (
      <Alert variant="destructive">
        <WifiOff aria-hidden="true" />
        <AlertTitle>Connection lost</AlertTitle>
        <AlertDescription>
          {retryError
            ? `Retry failed: ${retryError}. The token may have expired — reload the page to re-attach.`
            : "WebFlix lost the connection to the live provider. Nothing is being published right now."}
        </AlertDescription>
        <div className="mt-3">
          <Button
            size="sm"
            variant="outline"
            disabled={retrying}
            onClick={() => {
              setRetrying(true);
              setRetryError(null);
              void room
                .connect(url, token)
                .catch((err: unknown) =>
                  setRetryError(err instanceof Error ? err.message : "unknown error"),
                )
                .finally(() => setRetrying(false));
            }}
          >
            {retrying ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-4" aria-hidden="true" />
            )}
            Retry connection
          </Button>
        </div>
      </Alert>
    );
  }

  if (state === ConnectionState.Connecting || !everConnected) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Connecting to the live provider…
      </p>
    );
  }

  return null;
}

/** The host's own camera tile, straight from the published local track. */
function LocalCameraTile() {
  const trackRefs = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const localRef = trackRefs.find((ref) => ref.participant.isLocal);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl border bg-black">
      {localRef ? (
        <VideoTrack trackRef={localRef} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
          <Loader2 className="size-6 animate-spin" aria-hidden="true" />
          <p>Starting your camera — the devices you tested in the preview are the ones being published.</p>
        </div>
      )}
      <span className="absolute bottom-2 left-2 rounded-sm bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
        You (host)
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ended summary                                                       */
/* ------------------------------------------------------------------ */

function EndedSummaryCard({
  room,
  onStartAnother,
}: {
  room: LiveRoomDto;
  onStartAnother: () => void;
}) {
  const session = room.currentSession;
  return (
    <Card data-testid="live-ended-summary">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="size-5 text-emerald-500" aria-hidden="true" />
          Stream ended
        </CardTitle>
        <CardDescription>&ldquo;{room.title}&rdquo; is no longer live.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Started
            </dt>
            <dd className="text-sm">{formatWhen(session?.startedAt ?? null)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Ended
            </dt>
            <dd className="text-sm">{formatWhen(session?.endedAt ?? null)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Duration
            </dt>
            <dd className="text-sm">
              {formatDuration(session?.startedAt ?? null, session?.endedAt ?? null)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              End reason
            </dt>
            <dd className="text-sm">{endReasonLabel(session?.endReason ?? null)}</dd>
          </div>
        </dl>
        <Separator />
        <p className="text-sm text-muted-foreground">
          Viewer state has been reconciled — disconnected viewers no longer count
          as watching, and no phantom live room remains. Replays arrive in a
          later phase of the LIVE platform.
        </p>
        <Button onClick={onStartAnother}>
          <Radio className="size-4" aria-hidden="true" />
          Start another live
        </Button>
      </CardContent>
    </Card>
  );
}

/** Slow-mode choices (seconds) — 0 disables. */
const SLOW_MODE_CHOICES = [0, 10, 30, 60, 120, 300] as const;

/**
 * Phase 2 host policy controls — chat on/off + slow mode. Every change is
 * an audited moderation POST; the local mirror only renders what the
 * server confirmed (a failed POST keeps the previous value and says so).
 */
function HostPolicyControls(props: {
  roomId: string;
  chatEnabled: boolean;
  slowModeSeconds: number;
  onChatEnabled: (v: boolean) => void;
  onSlowMode: (v: number) => void;
}) {
  const [busy, setBusy] = useState(false);

  const perform = useCallback(
    async (body: PerformLiveModerationInput) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/live-rooms/${props.roomId}/moderation`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const detail = (await res.json().catch(() => ({}))) as { message?: string };
          toast.error("The change didn't stick", {
            description: detail.message ?? `Server answered ${res.status}.`,
          });
          return false;
        }
        return true;
      } catch {
        toast.error("Couldn't reach WebFlix — the change was not applied.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [props.roomId],
  );

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="text-base">Room policy</CardTitle>
        <CardDescription>
          Every change is audited and applied to every viewer instantly.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center justify-between gap-3 text-sm font-medium">
          <span>Chat</span>
          <Switch
            data-testid="live-policy-chat"
            checked={props.chatEnabled}
            disabled={busy}
            onCheckedChange={(v) => {
              const prev = props.chatEnabled;
              props.onChatEnabled(v);
              void perform({ action: v ? "chat-enable" : "chat-disable" }).then((ok) => {
                if (!ok) props.onChatEnabled(prev);
              });
            }}
            aria-label="Toggle room chat"
          />
        </label>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Slow mode</p>
          <div className="flex flex-wrap gap-1.5">
            {SLOW_MODE_CHOICES.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={props.slowModeSeconds === s ? "default" : "outline"}
                disabled={busy}
                onClick={() => {
                  const prev = props.slowModeSeconds;
                  props.onSlowMode(s);
                  void perform({ action: "slow-mode", slowModeSeconds: s }).then((ok) => {
                    if (!ok) props.onSlowMode(prev);
                  });
                }}
                className="h-8 min-w-11 px-2 text-xs"
              >
                {s === 0 ? "Off" : `${s}s`}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Viewers must wait this long between messages. Hosts and moderators are exempt.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
