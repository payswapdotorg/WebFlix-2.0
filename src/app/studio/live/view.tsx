"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Eye,
  Loader2,
  Lock,
  Mic,
  MicOff,
  PlugZap,
  Radio,
  RefreshCw,
  SmilePlus,
  Trash2,
  Users,
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
import { Skeleton } from "@/components/ui/skeleton";
import type {
  GiftCatalogItemDto,
  GiftEventDto,
  LiveAnalyticsSnapshotDto,
  LiveClubEmotesDto,
  LiveInviteDto,
  LiveMatchDto,
  LivePlaybackPlan,
  LiveRoomDto,
  LiveRoomPolicyDto,
  LiveSessionDto,
  LiveStageDto,
  LiveStreamEvent,
  PerformLiveModerationInput,
  SaveLiveClubEmoteInput,
  SendGiftInput,
} from "@/lib/live/types";
import { LiveChatPanel } from "@/components/live/live-chat-panel";
import { LiveReactionRail } from "@/components/live/live-reaction-rail";
import { LiveStageGrid } from "@/components/live/live-stage-grid";
import { LiveMatchPanel } from "@/components/live/live-match-panel";
import { LiveGiftPanel } from "@/components/live/live-gift-panel";
import {
  LiveRecorderConsole,
  useProgramRecorder,
  type LiveRecordingTake,
  type ProgramRecorder,
} from "@/components/live/live-recorder-console";
import { LiveReplayPanel } from "@/components/live/live-replay-panel";
import { ReattachCard } from "@/components/live/live-reattach-card";
import { useLivePresence, useLiveStream } from "@/components/live/use-live-stream";
import { useLiveClub } from "@/hooks/use-live-club";
import { useWebFlixSession } from "@/hooks/use-webflix-session";
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
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "members">("public");
  const [starting, setStarting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [providerFailure, setProviderFailure] = useState<ProviderFailure | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);

  // The room POST /api/live-rooms created, kept across a failed session
  // start so "try again" reuses the SAME room — no duplicate idle rooms.
  const [stagedRoom, setStagedRoom] = useState<LiveRoomDto | null>(null);

  // P68 re-attach: the mount probe finds the caller's ACTIVE live room (a
  // console that reloads mid-broadcast re-takes its session instead of
  // orphaning it). The playback plan is still minted by the server and
  // held in memory only — re-attach adds no new token surface.
  const [reattachRoom, setReattachRoom] = useState<LiveRoomDto | null>(null);
  const [reattaching, setReattaching] = useState(false);
  const [reattachError, setReattachError] = useState<string | null>(null);

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

  /**
   * P68 re-attach: re-take the host console of an ACTIVE session. The
   * server derives the rung (mintJoinToken gives the room's hostId the
   * host rung — the caller cannot claim it), so the minted plan's role is
   * VERIFIED before the console flips live: anything but "host" is an
   * honest refusal. Nothing here starts or ends a stream — the session
   * keeps running exactly as it was. Resolves true when the console is
   * live again, false otherwise (with the honest copy already surfaced).
   * Defined BEFORE goLive: goLive's conflict path awaits this, so the
   * deps array must never read it before initialization (TDZ).
   */
  const reattachTo = useCallback(async (candidateRoomId: string): Promise<boolean> => {
    setReattachError(null);
    setReattaching(true);
    try {
      const minted = await postLive<{ playback: LivePlaybackPlan }>(
        `/api/live-rooms/${candidateRoomId}/token`,
        {},
      );
      if (minted.playback.role !== "host") {
        setReattachError(
          "The live provider did not issue a host token for this room, so this console cannot re-attach. The stream (if any) is unaffected.",
        );
        return false;
      }
      const detail = await fetch(`/api/live-rooms/${candidateRoomId}`, { cache: "no-store" });
      if (!detail.ok) {
        setReattachError(
          detail.status === 404
            ? "That room no longer exists — nothing to re-attach to."
            : `Re-attach failed while loading the room (HTTP ${detail.status}). The stream (if any) is unaffected — try again.`,
        );
        return false;
      }
      const { room: detailRoom } = (await detail.json()) as { room: LiveRoomDto };
      if (detailRoom.status === "ended") {
        // The session ended while the console was away (webhook, kill
        // switch) — there is nothing to re-attach to.
        setReattachRoom(null);
        setReattachError("That session has already ended — nothing to re-attach to.");
        return false;
      }
      // The private preview capture is over — the live room publishes its own.
      previewStreamRef.current?.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
      setPreviewStream(null);
      setPermState("ask");
      setRoom(detailRoom);
      setRoomId(detailRoom.id);
      setPlayback(minted.playback);
      setReattachRoom(null);
      setPhase("live");
      toast.success("Console re-attached — the stream kept running the whole time.");
      return true;
    } catch (err) {
      const failure = err as LiveRequestFailure;
      setReattachError(
        failure.code === "conflict"
          ? "That room has no live session to re-attach to (it may have ended)."
          : failure.code === "unauthenticated"
            ? "Sign in again to re-attach the console."
            : failure.code === "provider-not-configured" || failure.code === "provider-failed"
              ? "The live provider could not be reached to re-attach the console. The stream (if any) is unaffected — try again."
              : `Re-attach failed (${failure.code}). The stream (if any) is unaffected — try again.`,
      );
      return false;
    } finally {
      setReattaching(false);
    }
  }, []);

  /** Go Live: create the room, then start the session on it (two honest POSTs). */
  const goLive = useCallback(async () => {
    if (!titleValid || starting) return;
    setStarting(true);
    setFormError(null);
    setProviderFailure(null);
    setSignInRequired(false);
    setReattachError(null);
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
      setReattachRoom(null);
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
        case "conflict": {
          // P68: the room already has an active session — that is exactly
          // what re-attach exists for. Take the console back directly; the
          // old "Reload the page to re-attach" copy was a lie (a reload
          // reset the form and orphaned the running session). If re-attach
          // itself fails, the honest alert + candidate card stay above the
          // form and the stream is untouched. (conflict can only originate
          // at the session POST, so `working` is the room — the null guard
          // is for the type, and a null here simply leaves the honest
          // alert-less preflight untouched.)
          if (working) {
            setReattachRoom(working);
            await reattachTo(working.id);
          }
          break;
        }
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
  }, [titleValid, starting, trimmedTitle, visibility, stagedRoom, reattachTo]);

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

  // P68: one mount probe — "does the signed-in caller already have a live
  // session running?" Signed-out is the common cold-browser case (401 →
  // stay silent; the preflight handles sign-in). A transient probe failure
  // stays silent too: the conflict path re-attaches directly, and the
  // probe re-runs on the next full page load.
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const res = await fetch("/api/studio/live-session", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { room: LiveRoomDto | null };
        if (!cancelled && data.room) setReattachRoom(data.room);
      } catch {
        // silent — see above
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

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
    setReattachRoom(null);
    setReattachError(null);
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
        <>
          {reattachError && (
            <Alert variant="destructive" data-testid="reattach-error">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>Re-attach failed</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-2">
                <span>{reattachError}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setReattachError(null)}
                >
                  Dismiss
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {reattachRoom && (
            <ReattachCard
              room={reattachRoom}
              reattaching={reattaching}
              onReattach={() => void reattachTo(reattachRoom.id)}
              onDismiss={() => setReattachRoom(null)}
            />
          )}
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
        </>
      )}

      {/* Phase 4: the creator's past sessions with their derived analytics.
          Phase 5: the compact fan-club manager (create + roster, ADR-0010). */}
      {phase === "preflight" && (
        <>
          <ClubManagerCard />
          <PastSessionsCard />
        </>
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
  visibility: "public" | "unlisted" | "members";
  onVisibilityChange: (v: "public" | "unlisted" | "members") => void;
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

export function PreflightCard(props: PreflightCardProps) {
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
          {/* Phase 5: "members" joins the frozen CreateLiveRoomInput union —
              a native select (the live surfaces' convention) with the honest
              explainer right under it while it's chosen. */}
          <select
            id="go-live-visibility"
            data-testid="go-live-visibility"
            aria-label="Room visibility"
            value={visibility}
            onChange={(e) =>
              onVisibilityChange(e.target.value as "public" | "unlisted" | "members")
            }
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-72"
          >
            <option value="public">Public — listed in Live discovery while you stream</option>
            <option value="unlisted">Unlisted — only people with the room link can watch</option>
            <option value="members">Members — only your fan-club members can join this room</option>
          </select>
          {visibility === "members" && (
            <p data-testid="visibility-members-note" className="text-xs text-muted-foreground">
              Only your fan-club members can join this room. Discovery and replays honor the
              same gate.
            </p>
          )}
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
  // Phase 4 consent fact — LATCHED from the newest STAGE envelope (the
  // render-phase adjustment pattern): presence/chat events must NEVER
  // overwrite the recording fact, they only mean the heartbeat is alive.
  const [stageRecording, setStageRecording] = useState(false);
  const [seenStageEventId, setSeenStageEventId] = useState<string | null>(null);
  const recordingEnvelope = stream.latestEnvelope;
  if (
    recordingEnvelope &&
    recordingEnvelope.kind === "stage" &&
    recordingEnvelope.eventId !== seenStageEventId
  ) {
    setSeenStageEventId(recordingEnvelope.eventId);
    setStageRecording(Boolean(recordingEnvelope.stage.recording));
  }
  const [chatEnabled, setChatEnabled] = useState(true);
  const [slowModeSeconds, setSlowModeSeconds] = useState(0);
  // Phase 5: the members-only chat gate (the audited members-chat-enable/
  // members-chat-disable moderation actions) — optimistic mirror, same law
  // as chatEnabled: the local value only survives when the server confirms.
  const [membersOnlyChat, setMembersOnlyChat] = useState(false);
  const hostPolicy: LiveRoomPolicyDto = {
    chatEnabled,
    reactionsEnabled: true,
    slowModeSeconds,
    guestsEnabled: true,
    giftsEnabled: true,
    membersOnlyChat,
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
                : room.visibility === "members"
                  ? "This members-only room is visible only to your fan-club members."
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
            <Separator />
            {/* Phase 4: the host-capture recording sink (ADR-0008). Rendered
                INSIDE the LiveKitRoom so the bridge can read the local tracks. */}
            <ProgramRecordingControls roomId={room.id} stageRecording={stageRecording} />
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
          hostId={room.hostId}
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
            membersOnlyChat={membersOnlyChat}
            onChatEnabled={setChatEnabled}
            onSlowMode={setSlowModeSeconds}
            onMembersOnlyChat={setMembersOnlyChat}
          />
          <HostStageControls roomId={room.id} streamEnvelope={stream.latestEnvelope} />
          {/* Phase 5: the compact fan-club manager (create + roster). */}
          <ClubManagerCard />
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

/**
 * Phase 4: the host-capture recording bridge (ADR-0008). Lives INSIDE the
 * LiveKitRoom context so it can build the recorded MediaStream from the
 * local camera+mic tracks. The server's recording fact (stage envelope)
 * stays authoritative; the MediaRecorder is armed when the fact is true
 * and the take uploads through LiveRecorderConsole's stop path.
 */
function ProgramRecordingControls({
  roomId,
  stageRecording,
}: {
  roomId: string;
  stageRecording: boolean;
}) {
  const [recording, setRecording] = useState(stageRecording);
  // The React-documented render-phase adjustment (the same pattern the
  // stream hook uses for room changes): when the server's recording fact
  // moves, adopt it — guarded by the previously seen value, never an effect.
  const [lastStageFact, setLastStageFact] = useState(stageRecording);
  if (stageRecording !== lastStageFact) {
    setLastStageFact(stageRecording);
    setRecording(stageRecording);
  }
  const recorderRef = useRef<ProgramRecorder | null>(null);
  const recorder = useProgramRecorder();
  useEffect(() => {
    recorderRef.current = recorder;
  });
  const trackRefs = useTracks(
    [Track.Source.Camera, Track.Source.Microphone],
    { onlySubscribed: false },
  );

  // Arm the recorder once the recording is on AND local tracks exist.
  useEffect(() => {
    if (!recording) return;
    const rec = recorderRef.current;
    if (!rec || rec.recording || rec.unsupported) return;
    const tracks = trackRefs
      .map((ref) => ref.publication?.track?.mediaStreamTrack)
      .filter((t): t is MediaStreamTrack => Boolean(t));
    if (tracks.length === 0) return;
    rec.start(new MediaStream(tracks));
  }, [recording, trackRefs]);

  // Another console tab (or a mid-run re-attach) moved the server fact —
  // handled by the render-phase adjustment above, not an effect.

  const getRecordingTake = useCallback(
    async (): Promise<LiveRecordingTake | null> => recorderRef.current?.stop() ?? null,
    [],
  );

  return (
    <LiveRecorderConsole
      roomId={roomId}
      recording={recording}
      onRecordingChange={setRecording}
      getRecordingTake={getRecordingTake}
    />
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
        {/* Phase 4: the session's replay (host-controlled visibility) and the
            derived analytics — both server-truth, never client-claimed. */}
        <LiveReplayPanel roomId={room.id} hostView className="w-full" />
        <EndedAnalytics roomId={room.id} />
        <Button onClick={onStartAnother}>
          <Radio className="size-4" aria-hidden="true" />
          Start another live
        </Button>
      </CardContent>
    </Card>
  );
}

/** The ended summary's analytics block — the host GET re-derives on read. */
function EndedAnalytics({ roomId }: { roomId: string }) {
  const [snapshot, setSnapshot] = useState<LiveAnalyticsSnapshotDto | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/live-rooms/${roomId}/analytics`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as {
          snapshot?: LiveAnalyticsSnapshotDto;
          message?: string;
        } | null;
        if (!alive) return;
        if (res.ok && json?.snapshot) {
          setSnapshot(json.snapshot);
          setFailure(null);
        } else {
          setFailure(json?.message ?? "Analytics are unavailable right now.");
        }
      })
      .catch(() => {
        if (alive) setFailure("Analytics are unavailable right now.");
      });
    return () => {
      alive = false;
    };
  }, [roomId]);

  if (failure) {
    return (
      <p className="text-xs text-muted-foreground" role="note">
        {failure}
      </p>
    );
  }
  if (!snapshot) return <Skeleton className="h-20 w-full" />;
  return (
    <div data-testid="live-analytics-summary">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Session analytics
      </p>
      <dl className="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-3">
        <AnalyticsStat label="Peak viewers" value={snapshot.peakViewers} approx />
        <AnalyticsStat label="Unique viewers" value={snapshot.uniqueViewers} />
        <AnalyticsStat label="Chat messages" value={snapshot.chatMessages} />
        <AnalyticsStat label="Hearts tapped" value={snapshot.reactionHearts} />
        <AnalyticsStat label="Gift events" value={snapshot.giftEvents} />
        <AnalyticsStat label="Matches run" value={snapshot.matchesRun} />
      </dl>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Gift credits are dev credits — no cash value. Viewer figures are
        approximate and never billing facts.
      </p>
    </div>
  );
}

function AnalyticsStat({
  label,
  value,
  approx,
}: {
  label: string;
  value: number;
  approx?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {approx ? " (approx.)" : ""}
      </dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Phase 4: past sessions (studio analytics feed)                       */
/* ------------------------------------------------------------------ */

interface StudioSessionRow {
  room: { id: string; title: string; status: string; createdAt: string };
  session: LiveSessionDto;
  snapshot: LiveAnalyticsSnapshotDto | null;
  replay: { status: string; readyAt: string | null; durationMs: number | null } | null;
}

/**
 * The creator's own ended sessions with their server-derived analytics
 * (GET /api/studio/live-sessions — host-scoped by construction). The
 * snapshot rides the end-hook; a session that ended before Phase 4 simply
 * has no snapshot yet (an honest empty state, never a zero-filled fake).
 */
function PastSessionsCard() {
  const [rows, setRows] = useState<StudioSessionRow[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/studio/live-sessions", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as {
          sessions?: StudioSessionRow[];
          message?: string;
        } | null;
        if (!alive) return;
        if (res.ok && json?.sessions) setRows(json.sessions);
        else setFailure(json?.message ?? "Past sessions are unavailable right now.");
      })
      .catch(() => {
        if (alive) setFailure("Past sessions are unavailable right now.");
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Card data-testid="studio-past-sessions">
      <CardHeader>
        <CardTitle className="text-base">Past sessions</CardTitle>
        <CardDescription>
          Your ended broadcasts with their server-derived analytics — viewer
          figures are approximate, gift credits are dev credits (no cash
          value), and nothing here is client-claimable.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {failure && <p className="text-xs text-muted-foreground">{failure}</p>}
        {!failure && rows === null && (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}
        {rows !== null && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No ended sessions yet — your broadcast history and analytics appear
            here after your first stream.
          </p>
        )}
        {rows !== null &&
          rows.map((row) => (
            <div
              key={row.session.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{row.room.title}</p>
                <p className="text-xs text-muted-foreground">
                  Ended {formatWhen(row.session.endedAt ?? null)}
                  {row.session.endReason ? ` · ${endReasonLabel(row.session.endReason)}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums">
                {row.snapshot ? (
                  <>
                    <Badge variant="outline">
                      {formatDuration(row.session.startedAt ?? null, row.session.endedAt ?? null)}
                    </Badge>
                    <Badge variant="outline">
                      peak {row.snapshot.peakViewers} (approx.)
                    </Badge>
                    <Badge variant="outline">{row.snapshot.uniqueViewers} viewers</Badge>
                    <Badge variant="outline">{row.snapshot.chatMessages} chat</Badge>
                    <Badge variant="outline">{row.snapshot.reactionHearts} hearts</Badge>
                    <Badge variant="outline">{row.snapshot.giftEvents} gifts</Badge>
                    <Badge variant="outline">{row.snapshot.matchesRun} matches</Badge>
                  </>
                ) : (
                  <Badge variant="outline">no analytics yet</Badge>
                )}
                {row.replay && <Badge variant="secondary">replay: {row.replay.status}</Badge>}
              </div>
            </div>
          ))}
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
export function HostPolicyControls(props: {
  roomId: string;
  chatEnabled: boolean;
  slowModeSeconds: number;
  /** Phase 5: the members-only chat gate (audited members-chat-* actions). */
  membersOnlyChat: boolean;
  onChatEnabled: (v: boolean) => void;
  onSlowMode: (v: number) => void;
  onMembersOnlyChat: (v: boolean) => void;
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
        {/* Phase 5: the members-only chat gate — same audited-action law as
            the chat toggle (optimistic mirror, rolled back on failure). */}
        <label className="flex items-center justify-between gap-3 text-sm font-medium">
          <span className="min-w-0">
            Members-only chat
            <span className="block text-xs font-normal text-muted-foreground">
              While this is on, only your fan-club members can chat.
            </span>
          </span>
          <Switch
            data-testid="live-policy-members-chat"
            checked={props.membersOnlyChat}
            disabled={busy}
            onCheckedChange={(v) => {
              const prev = props.membersOnlyChat;
              props.onMembersOnlyChat(v);
              void perform({
                action: v ? "members-chat-enable" : "members-chat-disable",
              }).then((ok) => {
                if (!ok) props.onMembersOnlyChat(prev);
              });
            }}
            aria-label="Toggle members-only chat"
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

/* ------------------------------------------------------------------ */
/* Phase 5 — the compact fan-club manager card (ADR-0010)              */
/*                                                                     */
/* The creator's own club, spoken entirely in the frozen overview DTO: */
/* GET /api/live-clubs/[myId] answering 404 is the honest empty state  */
/* with the create form; a club renders the member count + the bounded */
/* top-members preview. Points render ONLY under the ADR-0010 framing  */
/* ("Fan points — no cash value"), never as a balance or a currency.   */
/* ------------------------------------------------------------------ */

/** Frozen numeric law — mirrors src/lib/live/permissions.ts (server-only). */
const CLUB_NAME_MAX = 40;
const CLUB_MOTTO_MAX = 120;
/** The emote form's level input ceiling — the server clamps to CLUB_LEVEL_MAX. */
const EMOTE_LEVEL_MAX_INPUT = 50;

export function ClubManagerCard() {
  const { status, user } = useWebFlixSession();
  // The manager speaks the caller's OWN overview: hostId = the signed-in
  // creator's id — the same frozen GET /api/live-clubs/[hostId] the viewer
  // panel uses, so the studio surface invents no second contract.
  const club = useLiveClub(status === "authenticated" ? (user?.id ?? null) : null);
  const [name, setName] = useState("");
  const [motto, setMotto] = useState("");

  // ── Phase 5-emotes (ADR-0011): the supporter-emote manager ──
  // Emotes are HOST-MANAGED CONFIGURATION, never history and never money:
  // the card speaks ONLY the frozen routes (GET/POST/DELETE
  // /api/live-clubs/emotes) and toasts the server's message verbatim on
  // failure (a failed save never fakes a row). The list re-fetches from
  // the server after every confirmed save/delete — no optimistic rows.
  const [emotes, setEmotes] = useState<LiveClubEmotesDto["emotes"]>([]);
  const [emotesLoaded, setEmotesLoaded] = useState(false);
  const [emoteTick, setEmoteTick] = useState(0);
  const [emoteBusy, setEmoteBusy] = useState(false);
  const [emoteCode, setEmoteCode] = useState("");
  const [emoteGlyph, setEmoteGlyph] = useState("");
  const [emoteLevel, setEmoteLevel] = useState(1);

  const overview = club.overview;

  // The emote set exists only for an existing club — load once the
  // overview confirms one (the create form state needs no emote manager).
  useEffect(() => {
    const hostId = user?.id ?? null;
    if (!hostId || !overview) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/live-clubs/emotes?hostId=${encodeURIComponent(hostId)}`,
          { cache: "no-store", credentials: "same-origin" },
        );
        const body = (await res.json().catch(() => null)) as LiveClubEmotesDto | null;
        if (cancelled) return;
        setEmotes(res.ok && Array.isArray(body?.emotes) ? body.emotes : []);
        setEmotesLoaded(true);
      } catch {
        if (!cancelled) setEmotesLoaded(true); // an empty honest list, not a crash
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, overview, emoteTick]);

  /** Save (upsert by code) → refresh the list from the server. */
  async function saveEmote(): Promise<void> {
    const code = emoteCode.trim();
    const unicode = emoteGlyph.trim();
    if (code.length === 0 || unicode.length === 0 || emoteBusy) return;
    setEmoteBusy(true);
    try {
      const level =
        Number.isFinite(emoteLevel) && emoteLevel >= 1
          ? Math.min(EMOTE_LEVEL_MAX_INPUT, Math.floor(emoteLevel))
          : 1;
      const res = await fetch("/api/live-clubs/emotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ code, unicode, requiredLevel: level } satisfies SaveLiveClubEmoteInput),
      });
      if (res.ok) {
        toast.success("Emote saved");
        setEmoteCode("");
        setEmoteGlyph("");
        setEmoteLevel(1);
        setEmoteTick((t) => t + 1); // the server's list replaces the form
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      toast.error(body.message ?? "Couldn't save the emote — nothing was changed.");
    } catch {
      toast.error("Couldn't reach WebFlix — the emote was not saved.");
    } finally {
      setEmoteBusy(false);
    }
  }

  /** Delete by code → refresh (deleting never rewrites past messages). */
  async function deleteEmote(code: string): Promise<void> {
    if (emoteBusy) return;
    setEmoteBusy(true);
    try {
      const res = await fetch(
        `/api/live-clubs/emotes?code=${encodeURIComponent(code)}`,
        { method: "DELETE", credentials: "same-origin", cache: "no-store" },
      );
      if (res.ok) {
        toast.success("Emote deleted");
        setEmoteTick((t) => t + 1);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      toast.error(body.message ?? "Couldn't delete the emote — nothing was changed.");
    } catch {
      toast.error("Couldn't reach WebFlix — the emote was not deleted.");
    } finally {
      setEmoteBusy(false);
    }
  }

  return (
    <Card data-testid="club-manager">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="size-4 text-muted-foreground" aria-hidden="true" />
            Fan club
          </CardTitle>
          <CardDescription>
            One club per creator. Members join from your live rooms — fan points have no
            cash value.
          </CardDescription>
        </div>
        {overview && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh fan club"
            data-testid="club-manager-refresh"
            disabled={club.loading}
            onClick={club.refresh}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {status === "loading" && (
          <div className="space-y-2" aria-busy="true" data-testid="club-manager-loading">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {status !== "loading" && !user && (
          <div className="space-y-2" data-testid="club-manager-signin">
            <p className="text-sm text-muted-foreground">
              Sign in to create and manage your fan club. Nothing was created — this card
              needs a signed-in creator.
            </p>
            <Button asChild size="sm">
              <Link href="/signin?redirect=%2Fstudio%2Flive">Sign in</Link>
            </Button>
          </div>
        )}

        {user && club.loading && (
          <div className="space-y-2" aria-busy="true" data-testid="club-manager-loading">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {user && club.loadError !== null && (
          <div className="space-y-2" data-testid="club-manager-error">
            <p role="alert" className="text-sm text-muted-foreground">
              Couldn&apos;t load your fan club —{" "}
              {club.loadErrorMessage ?? `the server answered “${club.loadError}”`}.
            </p>
            <Button variant="outline" size="sm" data-testid="club-manager-retry" onClick={club.refresh}>
              <RefreshCw className="size-4" aria-hidden="true" /> Retry
            </Button>
          </div>
        )}

        {user && club.clubMissing && (
          <div className="space-y-2" data-testid="club-manager-create-form">
            <p className="text-sm text-muted-foreground">
              You haven&apos;t started a fan club yet. Name it — members join from your
              live rooms and earn fan points by watching, chatting and gifting.
            </p>
            <Input
              aria-label="Club name"
              placeholder="Club name"
              value={name}
              maxLength={CLUB_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
            />
            <Input
              aria-label="Club motto (optional)"
              placeholder="Motto (optional)"
              value={motto}
              maxLength={CLUB_MOTTO_MAX}
              onChange={(e) => setMotto(e.target.value)}
            />
            <Button
              data-testid="club-manager-create"
              disabled={club.createBusy || name.trim().length === 0}
              onClick={() =>
                void club.create({
                  name: name.trim(),
                  ...(motto.trim() ? { motto: motto.trim() } : {}),
                })
              }
            >
              {club.createBusy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Users className="size-4" aria-hidden="true" />
              )}
              {club.createBusy ? "Creating…" : "Create fan club"}
            </Button>
            {club.actionError !== null && (
              <p role="alert" data-testid="club-manager-create-error" className="text-sm text-destructive">
                {club.actionError.copy}
              </p>
            )}
          </div>
        )}

        {user && overview && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" data-testid="club-manager-name">
                  {overview.club.name}
                </p>
                {overview.club.motto && (
                  <p className="truncate text-xs italic text-muted-foreground">
                    “{overview.club.motto}”
                  </p>
                )}
              </div>
              <p
                data-testid="club-points-note"
                className="inline-flex shrink-0 items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400"
              >
                Fan points — no cash value
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              <span data-testid="club-manager-count" className="font-semibold tabular-nums text-foreground">
                {overview.club.memberCount}
              </span>{" "}
              members
            </p>
            {overview.topMembers.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
                No members yet — they join from your live rooms.
              </p>
            ) : (
              <ul
                aria-label="Top members"
                data-testid="club-manager-members"
                className="slim-scrollbar max-h-96 space-y-1 overflow-y-auto pr-1"
              >
                {overview.topMembers.map((member, index) => (
                  <li
                    key={member.userId}
                    data-testid="club-manager-member"
                    className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5"
                  >
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      <span className="w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="min-w-0 truncate text-sm font-medium">{member.name}</span>
                      <span className="min-w-0 truncate text-xs text-muted-foreground">
                        @{member.handle}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      Lv {member.level} · {member.points} pts
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="px-1 text-[11px] leading-relaxed text-muted-foreground/80">
              Fan points are entertainment facts — no cash value, nothing to buy, nothing to
              convert.
            </p>

            {/* ── Phase 5-emotes (ADR-0011): the supporter-emote manager.
                Configuration, not history: a deleted emote leaves old chat
                messages untouched (their codes render as plain text). ── */}
            <div
              data-testid="emote-manager"
              className="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <div className="flex items-center gap-2">
                <SmilePlus className="size-4 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm font-medium">Emotes</p>
              </div>
              {!emotesLoaded ? (
                <p className="px-1 text-xs text-muted-foreground">Loading emotes…</p>
              ) : emotes.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
                  No emotes yet — add your club&apos;s first one below.
                </p>
              ) : (
                <ul aria-label="Club emotes" className="max-h-64 space-y-1 overflow-y-auto pr-1">
                  {emotes.map((emote) => (
                    <li
                      key={emote.code}
                      data-testid="emote-row"
                      data-code={emote.code}
                      className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="text-base leading-none" aria-hidden="true">
                          {emote.unicode}
                        </span>
                        <span className="text-xs text-muted-foreground">:{emote.code}:</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          Level {emote.requiredLevel}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Delete emote :${emote.code}:`}
                          data-testid="emote-delete"
                          disabled={emoteBusy}
                          onClick={() => void deleteEmote(emote.code)}
                        >
                          <Trash2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="space-y-2 border-t pt-2">
                <Input
                  aria-label="Emote code"
                  placeholder="Emote code, e.g. wave"
                  value={emoteCode}
                  maxLength={24}
                  pattern="[a-z0-9_-]{1,24}"
                  autoComplete="off"
                  onChange={(e) => setEmoteCode(e.target.value)}
                />
                <p className="px-1 text-[11px] text-muted-foreground">
                  Lowercase letters, numbers, “-” and “_” only — up to 24 characters.
                </p>
                <div className="grid grid-cols-[1fr_96px] gap-2">
                  <Input
                    aria-label="Emoji or character"
                    placeholder="👋"
                    value={emoteGlyph}
                    maxLength={16}
                    autoComplete="off"
                    onChange={(e) => setEmoteGlyph(e.target.value)}
                  />
                  <Input
                    aria-label="Required club level"
                    type="number"
                    min={1}
                    max={EMOTE_LEVEL_MAX_INPUT}
                    step={1}
                    value={emoteLevel}
                    onChange={(e) => setEmoteLevel(Number(e.target.value))}
                  />
                </div>
                <Button
                  data-testid="emote-save"
                  size="sm"
                  className="w-full"
                  disabled={
                    emoteBusy || emoteCode.trim().length === 0 || emoteGlyph.trim().length === 0
                  }
                  onClick={() => void saveEmote()}
                >
                  {emoteBusy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <SmilePlus className="size-4" aria-hidden="true" />
                  )}
                  {emoteBusy ? "Saving…" : "Save emote"}
                </Button>
                <p className="px-1 text-[11px] text-muted-foreground">
                  Members at or above the emote&apos;s level can use it in your room&apos;s chat.
                </p>
              </div>
              <p className="px-1 text-[11px] text-muted-foreground/80">
                Non-monetary — emotes are identity, not purchases.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Phase 3 — the host's stage & match box                              */
/*                                                                     */
/* Server-authoritative law: this panel renders server truth (stage    */
/* roster, pending invites, current match) and sends validated intent  */
/* only. Every action rides the frozen contracts; nothing here claims  */
/* a capability the server didn't confirm.                             */
/* ------------------------------------------------------------------ */

const MATCH_DURATION_CHOICES = [30, 60, 120, 300] as const;

function HostStageControls({
  roomId,
  streamEnvelope,
}: {
  roomId: string;
  streamEnvelope: LiveStreamEvent | null;
}) {
  const [stage, setStage] = useState<LiveStageDto | null>(null);
  const [invites, setInvites] = useState<LiveInviteDto[]>([]);
  const [match, setMatch] = useState<LiveMatchDto | null>(null);
  const [gifts, setGifts] = useState<GiftEventDto[]>([]);
  const [catalogue, setCatalogue] = useState<GiftCatalogItemDto[]>([]);
  const [matchKind, setMatchKind] = useState<"solo" | "team">("solo");
  const [matchDuration, setMatchDuration] = useState<number>(120);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [stageRes, inviteRes, matchRes, giftRes] = await Promise.all([
        fetch(`/api/live-rooms/${roomId}/stage`, { cache: "no-store" }),
        fetch(`/api/live-rooms/${roomId}/invites`, { cache: "no-store" }),
        fetch(`/api/live-rooms/${roomId}/matches/current`, { cache: "no-store" }),
        fetch(`/api/live-rooms/${roomId}/gifts?limit=10`, { cache: "no-store" }),
      ]);
      if (stageRes.ok) {
        const body = (await stageRes.json().catch(() => ({}))) as { stage?: LiveStageDto };
        setStage(body.stage ?? null);
      }
      if (inviteRes.ok) {
        const body = (await inviteRes.json().catch(() => ({}))) as { invites?: LiveInviteDto[] };
        setInvites((body.invites ?? []).filter((i) => i.status === "pending"));
      }
      if (matchRes.ok) {
        const body = (await matchRes.json().catch(() => ({}))) as { match?: LiveMatchDto | null };
        setMatch(body.match ?? null);
      }
      if (giftRes.ok) {
        const body = (await giftRes.json().catch(() => ({}))) as { gifts?: GiftEventDto[] };
        setGifts(body.gifts ?? []);
      }
    } catch {
      /* transient — the next envelope or interval re-derives */
    }
  }, [roomId]);

  useEffect(() => {
    // Deferred to a timer callback (the React-documented external-system
    // subscription shape) — the fetch's setState then lands outside the
    // effect body.
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload]);

  useEffect(() => {
    const kind = streamEnvelope?.kind;
    if (kind === "stage" || kind === "invite" || kind === "match" || kind === "gift") {
      const t = setTimeout(() => void reload(), 0);
      return () => clearTimeout(t);
    }
  }, [streamEnvelope, reload]);

  useEffect(() => {
    const t = setInterval(() => void reload(), 12_000);
    return () => clearInterval(t);
  }, [reload]);

  useEffect(() => {
    fetch("/api/live/gifts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { gifts?: GiftCatalogItemDto[] } | null) => setCatalogue(b?.gifts ?? []))
      .catch(() => setCatalogue([]));
  }, []);

  /** One honest action runner: busy + error + reload after every intent. */
  const run = useCallback(
    async (fn: () => Promise<Response>, failureLabel: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fn();
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          setError(body.message ?? `${failureLabel} (${res.status})`);
        }
      } catch {
        setError(`${failureLabel} — the network dropped.`);
      } finally {
        setBusy(false);
        void reload();
      }
    },
    [reload],
  );

  const postJson = (url: string, body: unknown) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const respond = (inviteId: string, action: "accept" | "decline") =>
    run(
      () => postJson(`/api/live-rooms/${roomId}/invites/${inviteId}/respond`, { action }),
      `Could not ${action} the invite`,
    );
  const removeGuest = (userId: string) =>
    run(
      () => fetch(`/api/live-rooms/${roomId}/stage/${userId}`, { method: "DELETE" }),
      "Could not remove the guest",
    );
  const togglePolicy = (action: "guests-enable" | "guests-disable" | "gifts-enable" | "gifts-disable") =>
    run(() => postJson(`/api/live-rooms/${roomId}/moderation`, { action }), "Could not update the room policy");

  const startMatch = () => {
    const host = stage?.participants.find((p) => p.role === "host");
    const guests = (stage?.participants ?? []).filter(
      (p) => p.role === "guest" && p.state !== "removed",
    );
    const roster =
      matchKind === "solo"
        ? { teamA: host ? [host.userId] : [], teamB: guests[0] ? [guests[0].userId] : [] }
        : { teamA: guests[0] ? [guests[0].userId] : [], teamB: guests[1] ? [guests[1].userId] : [] };
    return run(
      () =>
        postJson(`/api/live-rooms/${roomId}/matches`, {
          kind: matchKind,
          durationSeconds: matchDuration,
          ...roster,
        }),
      "Could not start the match",
    );
  };
  const endMatch = () =>
    match
      ? run(
          () => postJson(`/api/live-rooms/${roomId}/matches/${match.id}/end`, {}),
          "Could not end the match",
        )
      : undefined;
  const cancelMatch = () =>
    match
      ? run(
          () => postJson(`/api/live-rooms/${roomId}/matches/${match.id}/cancel`, {}),
          "Could not cancel the match",
        )
      : undefined;

  const guests = (stage?.participants ?? []).filter(
    (p) => p.role === "guest" && p.state !== "removed",
  );
  const matchActive = match?.status === "active";
  const canStart =
    !matchActive &&
    (matchKind === "solo" ? guests.length >= 1 : guests.length >= 2) &&
    !busy;
  const startHint =
    matchActive
      ? "A match is already running."
      : matchKind === "solo"
        ? "Solo matches need you plus one guest on stage."
        : "Team matches need two guests on stage (one per side).";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stage &amp; guests</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>Guest joins</span>
            <Switch
              checked={stage?.guestsEnabled ?? true}
              disabled={busy}
              onCheckedChange={(checked) =>
                void togglePolicy(checked ? "guests-enable" : "guests-disable")
              }
              aria-label="Toggle guest joins"
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>Gifts</span>
            <GiftsToggle roomId={roomId} onToggle={(a) => void togglePolicy(a)} busy={busy} />
          </div>

          {invites.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Pending requests ({invites.length})
              </p>
              {invites.map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {invite.direction === "guest-request" ? "requested" : "invited"}:{" "}
                    <span className="font-medium">{invite.inviteeName}</span>{" "}
                    <span className="text-muted-foreground">@{invite.inviteeHandle}</span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void respond(invite.id, "accept")}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void respond(invite.id, "decline")}
                    >
                      Decline
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          )}

          <LiveStageGrid stage={stage} />

          {guests.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Remove a guest
              </p>
              {guests.map((g) => (
                <div
                  key={g.userId}
                  className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {g.name} <span className="text-muted-foreground">@{g.handle}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={busy}
                    onClick={() => void removeGuest(g.userId)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Match</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {match ? (
            <>
              <LiveMatchPanel match={match} />
              {matchActive ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void endMatch()}>
                    End &amp; declare winner
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancelMatch()}>
                    Cancel match
                  </Button>
                </div>
              ) : null}
              {!matchActive && (
                <div className="space-y-3 border-t pt-3">
                  <div className="flex flex-wrap gap-1.5">
                    {(["solo", "team"] as const).map((k) => (
                      <Button
                        key={k}
                        size="sm"
                        variant={matchKind === k ? "default" : "outline"}
                        disabled={busy}
                        onClick={() => setMatchKind(k)}
                      >
                        {k === "solo" ? "Solo (you vs guest)" : "Team (guest vs guest)"}
                      </Button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {MATCH_DURATION_CHOICES.map((d) => (
                      <Button
                        key={d}
                        size="sm"
                        variant={matchDuration === d ? "default" : "outline"}
                        disabled={busy}
                        onClick={() => setMatchDuration(d)}
                      >
                        {d}s
                      </Button>
                    ))}
                  </div>
                  <Button size="sm" disabled={!canStart} onClick={() => void startMatch()}>
                    Start match
                  </Button>
                  {!canStart && !busy && <p className="text-xs text-muted-foreground">{startHint}</p>}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {(["solo", "team"] as const).map((k) => (
                  <Button
                    key={k}
                    size="sm"
                    variant={matchKind === k ? "default" : "outline"}
                    disabled={busy}
                    onClick={() => setMatchKind(k)}
                  >
                    {k === "solo" ? "Solo (you vs guest)" : "Team (guest vs guest)"}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {MATCH_DURATION_CHOICES.map((d) => (
                  <Button
                    key={d}
                    size="sm"
                    variant={matchDuration === d ? "default" : "outline"}
                    disabled={busy}
                    onClick={() => setMatchDuration(d)}
                  >
                    {d}s
                  </Button>
                ))}
              </div>
              <Button size="sm" disabled={!canStart} onClick={() => void startMatch()}>
                Start match
              </Button>
              {!canStart && !busy && <p className="text-xs text-muted-foreground">{startHint}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gift activity</CardTitle>
        </CardHeader>
        <CardContent>
          <LiveGiftPanel
            catalogue={catalogue}
            gifts={gifts}
            canSend={false}
            disabledReason="The host receives gifts — sending happens in the viewer room"
            activeMatchTeams={[]}
          />
        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The gifts toggle reads its own server truth (the audited policy). */
function GiftsToggle({
  roomId,
  onToggle,
  busy,
}: {
  roomId: string;
  onToggle: (action: "gifts-enable" | "gifts-disable") => void;
  busy: boolean;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/live-rooms/${roomId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { room?: { policy?: { giftsEnabled?: boolean } } } | null) => {
        if (alive && b?.room?.policy) setEnabled(b.room.policy.giftsEnabled ?? true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [roomId]);
  return (
    <Switch
      checked={enabled ?? true}
      disabled={busy || enabled === null}
      onCheckedChange={(checked) => {
        setEnabled(checked);
        onToggle(checked ? "gifts-enable" : "gifts-disable");
      }}
      aria-label="Toggle gifts"
    />
  );
}
