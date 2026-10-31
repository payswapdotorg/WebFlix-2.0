"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Eye,
  Info,
  Loader2,
  LogIn,
  RefreshCw,
  TriangleAlert,
  VideoOff,
  Volume2,
} from "lucide-react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useAudioPlayback,
  useConnectionState,
  useTracks,
} from "@livekit/components-react";
import { ConnectionState, Track, type DisconnectReason } from "livekit-client";
import { useApi } from "@/hooks/use-api";
import { useWebFlixSession } from "@/hooks/use-webflix-session";
import { formatCount, formatRelativeDate } from "@/lib/format";
import { LiveChatPanel } from "@/components/live/live-chat-panel";
import { LiveReactionRail } from "@/components/live/live-reaction-rail";
import { LivePollsQuestions } from "@/components/live/live-polls-questions";
import { LiveStageGrid } from "@/components/live/live-stage-grid";
import { LiveMatchPanel } from "@/components/live/live-match-panel";
import { LiveGiftPanel } from "@/components/live/live-gift-panel";
import { useLiveStream } from "@/components/live/use-live-stream";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type {
  GiftCatalogItemDto,
  GiftEventDto,
  LiveApiError,
  LiveInviteDto,
  LiveMatchDto,
  LivePlaybackPlan,
  LiveRoomDto,
  LiveSessionDto,
  LiveStageDto,
  SendGiftInput,
} from "@/lib/live/types";

/**
 * WFX2-LIVE-PLATFORM-1 §7 Worker 2 — the first-party viewer room.
 *
 * Honest-state law (work order principle #8), applied end to end:
 * - a LIVE badge appears ONLY when room.status === "live" AND the current
 *   session is transport-live;
 * - loading skeletons, an explicit ended state (endedAt/endReason when the
 *   API carries them), an idle "host hasn't started" state, and a plain
 *   not-found state all tell the truth instead of faking a frame;
 * - token failures surface their REAL error codes: "provider-not-configured"
 *   explains that this deployment hasn't connected a live provider,
 *   "unauthenticated" offers sign-in, "conflict" means no active broadcast;
 * - LiveKitRoom onError/onDisconnected produce an explicit connect-error
 *   panel whose Retry re-mints a fresh short-lived token;
 * - the viewer token is SUBSCRIBE-ONLY (server-enforced) and the UI offers
 *   zero publish affordances — even if a caller somehow held a publish
 *   grant, this surface renders no publish controls (defense in depth).
 *
 * The playback token exists only in this component's memory — never in a
 * URL, a log line or persisted state.
 */

type TokenFailureCode = LiveApiError["error"] | "network";

/** Deterministic avatar hue from a handle (rooms carry no avatar asset yet). */
function hueFromString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

function HostInitial({ handle, className }: { handle: string; className?: string }) {
  const initial = (handle.trim()[0] ?? "W").toUpperCase();
  return (
    <span
      aria-hidden
      className={`flex select-none items-center justify-center rounded-full font-semibold text-white ${className ?? "size-9 text-sm"}`}
      style={{ backgroundColor: `hsl(${hueFromString(handle)} 45% 32%)` }}
    >
      {initial}
    </span>
  );
}

/** The real LIVE badge — only rendered when the session is transport-live. */
function LiveBadge() {
  return (
    <span
      data-testid="live-badge"
      className="inline-flex items-center gap-1.5 rounded-md bg-yt-red px-2 py-0.5 text-[11px] font-bold uppercase text-white"
    >
      <span className="size-1.5 animate-pulse rounded-full bg-white" aria-hidden /> Live
    </span>
  );
}

function TransportChip({ label, tone }: { label: string; tone: "amber" | "muted" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase ${
        tone === "amber"
          ? "bg-amber-500/15 text-amber-400"
          : "bg-secondary text-muted-foreground"
      }`}
    >
      {tone === "amber" && <span className="size-1.5 animate-pulse rounded-full bg-amber-400" aria-hidden />}
      {label}
    </span>
  );
}

/** The approximate-viewer chip — the count is an estimate, so it says so. */
function ApproxViewers({ count }: { count: number }) {
  return (
    <span
      data-testid="live-viewer-count"
      title="Approximate viewer count — WebFlix live counts are estimates, not exact tallies."
      className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
    >
      <Eye className="size-3.5" aria-hidden />
      ≈ {formatCount(count)} watching
      <span className="sr-only">viewers (approximate)</span>
    </span>
  );
}

const END_REASON_COPY: Record<Exclude<LiveSessionDto["endReason"], null>, string> = {
  host: "The host ended this broadcast.",
  "provider-webhook": "The video provider reported the broadcast ended.",
  timeout: "The broadcast ended after a timeout.",
};

/** Mint a short-lived, room-scoped join token — code kept, not stringified. */
async function mintViewerToken(
  roomId: string,
  signal: AbortSignal,
  body: Record<string, unknown> = {},
): Promise<{ ok: true; playback: LivePlaybackPlan } | { ok: false; code: TokenFailureCode; message?: string }> {
  try {
    const res = await fetch(`/api/live-rooms/${roomId}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
    const payload = (await res
      .json()
      .catch(() => ({}))) as Partial<LiveApiError> & { playback?: LivePlaybackPlan };
    if (!res.ok || !payload.playback) {
      return {
        ok: false,
        code: payload.error ?? "network",
        message: payload.message,
      };
    }
    return { ok: true, playback: payload.playback };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return { ok: false, code: "network" };
  }
}

function StateCard({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <div
      data-testid={testId}
      className="flex aspect-video w-full flex-col items-center justify-center gap-3 overflow-hidden bg-black px-6 text-center sm:rounded-xl"
    >
      {children}
    </div>
  );
}

function StageNote({ icon, title, body }: { icon: React.ReactNode; title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="flex size-12 items-center justify-center rounded-full bg-white/10 text-white" aria-hidden>
        {icon}
      </span>
      <p className="text-sm font-medium text-white">{title}</p>
      {body && <p className="max-w-md text-sm text-white/60">{body}</p>}
    </div>
  );
}

/**
 * The stage INSIDE the LiveKit room context. Subscribe-only: it renders the
 * program video (camera, falling back to a screen share) and room audio —
 * and nothing else. There are deliberately NO publish controls here.
 */
function ViewerStage({ hostName }: { hostName: string }) {
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], {
    onlySubscribed: true,
  });
  const connectionState = useConnectionState();
  const { canPlayAudio, startAudio } = useAudioPlayback();

  const camera = tracks.find((t) => t.source === Track.Source.Camera);
  const program = camera ?? tracks[0];

  const chipLabel =
    connectionState === ConnectionState.Connected
      ? "Live feed"
      : connectionState === ConnectionState.Connecting
        ? "Connecting…"
        : connectionState === ConnectionState.Reconnecting ||
            connectionState === ConnectionState.SignalReconnecting
          ? "Reconnecting…"
          : "Disconnected";

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-black">
      {program ? (
        <VideoTrack trackRef={program} className="h-full w-full bg-black object-contain" />
      ) : connectionState === ConnectionState.Connecting ? (
        <StageNote
          icon={<Loader2 className="size-6 animate-spin" />}
          title="Connecting to the live room…"
        />
      ) : connectionState === ConnectionState.Reconnecting ||
        connectionState === ConnectionState.SignalReconnecting ? (
        <StageNote
          icon={<Loader2 className="size-6 animate-spin" />}
          title="Reconnecting to the host…"
          body="The connection dropped — LiveKit is bringing it back. If it can't, use the retry control."
        />
      ) : (
        <StageNote
          icon={<VideoOff className="size-6" />}
          title={`Waiting for ${hostName || "the host"}'s video…`}
          body={
            connectionState === ConnectionState.Connected
              ? "You're connected. Audio still plays — the host hasn't published video yet."
              : undefined
          }
        />
      )}

      {connectionState === ConnectionState.Connected && !canPlayAudio && (
        <Button size="sm" className="absolute bottom-3 left-3" onClick={() => void startAudio()}>
          <Volume2 aria-hidden /> Enable sound
        </Button>
      )}

      <span
        role="status"
        aria-live="polite"
        className="absolute right-3 top-3 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-white"
      >
        {chipLabel}
      </span>
    </div>
  );
}

/**
 * Phase 3 — the GUEST publishing stage. Rendered only when this browser's
 * minted token carries the guest rung (an accepted invite, server-verified).
 * Publishes camera + mic ONLY after the explicit consent step that precedes
 * the token mint; renders the multi-participant program (host + guests) and
 * the caller's own tile.
 */
function GuestStage({ hostName }: { hostName: string }) {
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], {
    onlySubscribed: true,
  });
  const localRefs = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const localRef = localRefs.find((ref) => ref.participant.isLocal);
  const connectionState = useConnectionState();

  return (
    <div className="flex h-full w-full flex-col gap-2 bg-black p-2">
      <div className="grid flex-1 grid-cols-1 gap-2 overflow-hidden sm:grid-cols-2">
        {tracks.map((ref) => (
          <div
            key={ref.participant.identity}
            className="relative min-h-0 overflow-hidden rounded-lg bg-black"
          >
            <VideoTrack trackRef={ref} className="h-full w-full object-contain" />
            <span className="absolute bottom-2 left-2 rounded-sm bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
              {ref.participant.name || hostName || "Host"}
            </span>
          </div>
        ))}
        <div className="relative min-h-0 overflow-hidden rounded-lg bg-black">
          {localRef ? (
            <VideoTrack trackRef={localRef} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
              <Loader2 className="size-6 animate-spin" aria-hidden="true" />
              <p>Starting your camera — you&apos;re publishing as a guest.</p>
            </div>
          )}
          <span className="absolute bottom-2 left-2 rounded-sm bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
            You (guest)
          </span>
        </div>
      </div>
      <span
        role="status"
        aria-live="polite"
        className="self-end rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-white"
      >
        {connectionState === ConnectionState.Connected
          ? "Publishing as guest"
          : connectionState === ConnectionState.Connecting
            ? "Connecting…"
            : connectionState === ConnectionState.Reconnecting ||
                connectionState === ConnectionState.SignalReconnecting
              ? "Reconnecting…"
              : "Disconnected"}
      </span>
    </div>
  );
}

export default function ViewerRoomView({ roomId }: { roomId: string }) {
  const {
    data,
    error: roomError,
    reload: reloadRoom,
  } = useApi<{ room: LiveRoomDto }>(`/api/live-rooms/${roomId}`);
  const room = data?.room ?? null;
  const { user } = useWebFlixSession();

  // ── Phase 3 (guests, matches, gifts) — slices of the ONE page stream ──
  const [stage, setStage] = useState<LiveStageDto | null>(null);
  const [match, setMatch] = useState<LiveMatchDto | null>(null);
  const [gifts, setGifts] = useState<GiftEventDto[]>([]);
  const [catalogue, setCatalogue] = useState<GiftCatalogItemDto[]>([]);
  const [giftSending, setGiftSending] = useState(false);
  const [giftError, setGiftError] = useState<string | null>(null);
  const [myInvite, setMyInvite] = useState<LiveInviteDto | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  /** The caller's own pending invite/request — the renderer never guesses. */
  const refreshMyInvite = useCallback(async () => {
    if (!user) {
      setMyInvite(null);
      return;
    }
    try {
      const res = await fetch(`/api/live-rooms/${roomId}/invites`, { cache: "no-store" });
      if (!res.ok) {
        setMyInvite(null);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { invites?: LiveInviteDto[] };
      setMyInvite(body.invites?.find((i) => i.status === "pending") ?? null);
    } catch {
      setMyInvite(null);
    }
  }, [roomId, user]);

  // ONE stream subscription for the whole page (ADR-0006 economics): chat
  // rows, reaction totals, presence and the moderation/poll/question
  // envelopes all flow through here; panels receive slices as props.
  const stream = useLiveStream(roomId, {
    onRoomChange: reloadRoom,
    onEnvelope: (event) => {
      // A moderation decision may have changed room policy (chat-disable,
      // slow-mode, gifts-disable) — the caller-scoped policy lives on the
      // room GET.
      if (event.kind === "moderation") {
        void reloadRoom();
        return;
      }
      if (event.kind === "stage") {
        setStage(event.stage);
        return;
      }
      if (event.kind === "match") {
        setMatch(event.match);
        return;
      }
      if (event.kind === "gift") {
        // Prepend + dedupe by id (at-least-once transport can re-deliver).
        setGifts((prev) =>
          [event.gift, ...prev.filter((g) => g.id !== event.gift.id)].slice(0, 50),
        );
        return;
      }
      if (event.kind === "invite") {
        // Any invite change may concern THIS caller (request approved, invite
        // expired...) — the caller-scoped GET is the truth, not identity
        // comparisons in the renderer.
        void refreshMyInvite();
      }
    },
  });
  const canModerate =
    room?.policy?.actorRole === "host" ||
    room?.policy?.actorRole === "moderator" ||
    (room?.policy == null && room?.isHost === true);

  // Mint lifecycle state. `minting` is DERIVED (no setState-in-effect): a
  // mint is in flight exactly when the room is live, has a session, no
  // token for that session has landed yet, and no failure for it either.
  const [mintedToken, setMintedToken] = useState<LivePlaybackPlan | null>(null);
  const [mintedSessionId, setMintedSessionId] = useState<string | null>(null);
  const [mintFailure, setMintFailure] = useState<{
    sessionId: string;
    code: TokenFailureCode;
    message?: string;
  } | null>(null);
  const [mintNonce, setMintNonce] = useState(0);
  const [transportError, setTransportError] = useState<string | null>(null);

  const session = room?.currentSession ?? null;
  const sessionId = session?.id ?? null;
  const roomStatus = room?.status ?? null;
  const sessionLive = room?.status === "live" && session?.status === "live";

  // The token is only honoured while it matches the CURRENT live session —
  // a session change or retry invalidates it in the render phase itself.
  const activePlayback =
    mintedSessionId !== null && sessionId !== null && sessionId === mintedSessionId
      ? mintedToken
      : null;
  const mintFailureForSession =
    mintFailure && mintFailure.sessionId === sessionId ? mintFailure : null;
  const minting =
    room?.status === "live" &&
    sessionId !== null &&
    activePlayback === null &&
    mintFailureForSession === null;

  // Freshness poll while the room is live: keeps the (approximate) viewer
  // count honest and surfaces the ended transition quickly. A non-live room
  // stops polling — ended/idle states are stable.
  useEffect(() => {
    if (roomStatus !== "live") return;
    const t = setInterval(() => reloadRoom(), 15_000);
    return () => clearInterval(t);
  }, [roomStatus, reloadRoom]);

  // Token mint lifecycle: one token per live session; retry re-mints. The
  // minted token is held in component state ONLY (never a URL/log/storage).
  // Deps are primitives — a routine room poll (fresh object identity) can't
  // abort/restart an in-flight mint.
  useEffect(() => {
    if (roomStatus !== "live" || !roomId || !sessionId) return;
    if (sessionId === mintedSessionId) return;
    // Already attempted (and failed) for THIS session — further attempts are
    // explicit retry actions, not automatic hammering on every room poll.
    if (mintFailure && mintFailure.sessionId === sessionId) return;
    const controller = new AbortController();
    let cancelled = false;
    mintViewerToken(roomId, controller.signal)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setMintedSessionId(sessionId);
          setMintedToken(result.playback);
          setMintFailure(null);
        } else {
          setMintFailure({
            sessionId,
            code: result.code,
            message: result.message,
          });
        }
      })
      .catch(() => {
        /* aborted — a newer effect run owns the mint now */
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [roomStatus, roomId, sessionId, mintedSessionId, mintFailure, mintNonce]);

  /** Retry = discard everything (old token included) and re-mint fresh. */
  const retryPlayback = useCallback(() => {
    setTransportError(null);
    setMintedSessionId(null);
    setMintedToken(null);
    setMintFailure(null);
    setMintNonce((n) => n + 1);
  }, []);

  const onTransportError = useCallback((err: Error) => {
    setTransportError(err.message || "The live connection failed.");
  }, []);

  const onTransportDisconnected = useCallback((_reason?: DisconnectReason) => {
    // The room poll reconciles the true ended state within 15s; until then
    // this honest message stands.
    setTransportError(
      "The connection to this live room closed. The host may have ended the broadcast — or the connection dropped.",
    );
  }, []);

  // ── Phase 3 mount loads: catalogue + gift feed + the caller's invites ──
  // (the stream baseline covers stage/match; the catalogue is never streamed)
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const [catRes, feedRes] = await Promise.all([
          fetch("/api/live/gifts", { cache: "no-store", signal: controller.signal }),
          fetch(`/api/live-rooms/${roomId}/gifts?limit=20`, {
            cache: "no-store",
            signal: controller.signal,
          }),
        ]);
        if (catRes.ok) {
          const body = (await catRes.json().catch(() => ({}))) as { gifts?: GiftCatalogItemDto[] };
          setCatalogue(body.gifts ?? []);
        }
        if (feedRes.ok) {
          const body = (await feedRes.json().catch(() => ({}))) as { gifts?: GiftEventDto[] };
          setGifts(body.gifts ?? []);
        }
      } catch {
        /* aborted or offline — the stream re-derives what it can */
      }
    };
    void load();
    return () => controller.abort();
  }, [roomId]);

  useEffect(() => {
    // Deferred to a timer callback (external-system subscription shape —
    // the fetch's setState must not land in the effect body).
    const t = setTimeout(() => void refreshMyInvite(), 0);
    return () => clearTimeout(t);
  }, [refreshMyInvite]);

  /** Send a gift (dev credits). The response/dedupe rides the stream. */
  const sendGift = useCallback(
    async (input: SendGiftInput) => {
      setGiftSending(true);
      setGiftError(null);
      try {
        const res = await fetch(`/api/live-rooms/${roomId}/gifts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const body = (await res.json().catch(() => ({}))) as {
          gift?: GiftEventDto;
          error?: string;
          message?: string;
        };
        if (!res.ok || !body.gift) {
          setGiftError(
            body.message ??
              (body.error === "spend-cap"
                ? "You've reached the dev-credit limit for now — try again in a minute."
                : `Sending failed (${body.error ?? "network"}).`),
          );
          return;
        }
        setGifts((prev) => [body.gift!, ...prev.filter((g) => g.id !== body.gift!.id)].slice(0, 50));
      } catch {
        setGiftError("Sending failed — the network dropped.");
      } finally {
        setGiftSending(false);
      }
    },
    [roomId],
  );

  /** Request to join the stage (a signed-in viewer's self-request). */
  const requestGuestSlot = useCallback(async () => {
    setInviteBusy(true);
    setInviteError(null);
    try {
      const res = await fetch(`/api/live-rooms/${roomId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setInviteError(body.message ?? `The request failed (${body.error ?? "network"}).`);
      }
    } catch {
      setInviteError("The request failed — the network dropped.");
    } finally {
      setInviteBusy(false);
      void refreshMyInvite();
    }
  }, [roomId, refreshMyInvite]);

  /** Respond to the caller's pending invite (accept = guest consent gate). */
  const respondMyInvite = useCallback(
    async (action: "accept" | "decline") => {
      if (!myInvite) return;
      setInviteBusy(true);
      setInviteError(null);
      try {
        const res = await fetch(
          `/api/live-rooms/${roomId}/invites/${myInvite.id}/respond`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
          };
          setInviteError(body.message ?? `The response failed (${body.error ?? "network"}).`);
          return;
        }
        setMyInvite(null);
      } catch {
        setInviteError("The response failed — the network dropped.");
      } finally {
        setInviteBusy(false);
      }
    },
    [roomId, myInvite],
  );

  /** Accept consent → mint the GUEST rung (publish) and swap transports. */
  const joinStageAsGuest = useCallback(async () => {
    await respondMyInvite("accept");
    const controller = new AbortController();
    const result = await mintViewerToken(roomId, controller.signal, { role: "guest" });
    if (result.ok) {
      setMintedSessionId(sessionId);
      setMintedToken(result.playback);
      setMintFailure(null);
      setTransportError(null);
    } else {
      // Honest degrade: the server refused the guest rung (expired invite,
      // removed, stage full) — back to the viewer token.
      setInviteError(
        result.message ?? "The stage join was refused by the server — you're still watching as a viewer.",
      );
    }
  }, [roomId, respondMyInvite, sessionId]);

  const roomEnded = room?.status === "ended";
  const showTransportError = !roomEnded && transportError !== null;

  return (
    <div
      data-testid="live-room-viewer"
      className="mx-auto w-full max-w-[1754px] px-4 pb-10 pt-4 md:px-6 md:pt-6"
    >
      <Link
        href="/live"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> All live rooms
      </Link>

      <header className="mt-3">
        {room ? (
          <>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-lg font-bold sm:text-xl">{room.title}</h1>
              {sessionLive ? (
                <LiveBadge />
              ) : room.status === "live" ? (
                session?.status === "reconnecting" ? (
                  <TransportChip label="Reconnecting" tone="amber" />
                ) : (
                  <TransportChip label="Starting…" tone="muted" />
                )
              ) : room.status === "idle" ? (
                <TransportChip label="Idle" tone="muted" />
              ) : (
                <TransportChip label="Ended" tone="muted" />
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <ApproxViewers count={room.viewerCount} />
              <span className="text-xs">
                {room.hostName} · @{room.hostHandle}
                {room.isHost === true && (
                  <Badge variant="secondary" className="ml-2 h-4 px-1 text-[10px] uppercase">
                    You host
                  </Badge>
                )}
              </span>
              {session?.startedAt && (
                <span className="text-xs">Started {formatRelativeDate(session.startedAt)}</span>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        )}
      </header>

      <div className="mt-4 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── Stage / state column ─────────────────────────────────────── */}
        <main>
          {(() => {
            // ── Room-level states first (they own the whole stage) ──
            if (roomError === "not-found") {
              return (
                <StateCard testId="live-not-found">
                  <StageNote
                    icon={<TriangleAlert className="size-6" />}
                    title="Room not found"
                    body="This room doesn't exist anymore, or the link is wrong. Nothing is hidden — it's simply gone."
                  />
                  <Button asChild variant="outline" size="sm">
                    <Link href="/live">Browse live rooms</Link>
                  </Button>
                </StateCard>
              );
            }
            if (roomError) {
              return (
                <div className="py-6" data-testid="live-room-error">
                  <Alert variant="destructive">
                    <TriangleAlert aria-hidden />
                    <AlertTitle>Couldn't load this room</AlertTitle>
                    <AlertDescription>
                      <p>
                        WebFlix LIVE couldn't fetch the room state ({roomError}). This is a real
                        failure, not a missing stream.
                      </p>
                      <Button variant="outline" size="sm" onClick={reloadRoom} className="mt-1">
                        <RefreshCw aria-hidden /> Retry
                      </Button>
                    </AlertDescription>
                  </Alert>
                </div>
              );
            }
            if (!room) {
              return (
                <div aria-busy="true" aria-label="Loading live room">
                  <Skeleton className="aspect-video w-full sm:rounded-xl" />
                </div>
              );
            }
            if (room.status === "ended") {
              const ended = room.currentSession;
              return (
                <StateCard testId="live-ended-state">
                  <StageNote
                    icon={<VideoOff className="size-6" />}
                    title="Stream ended"
                    body={
                      ended?.endReason
                        ? END_REASON_COPY[ended.endReason]
                        : "This broadcast is over. WebFlix doesn't fake a live frame once it's gone."
                    }
                  />
                  {ended?.endedAt && (
                    <p className="text-xs text-white/50">
                      Ended {formatRelativeDate(ended.endedAt)}
                    </p>
                  )}
                  <Button asChild variant="outline" size="sm">
                    <Link href="/live">Browse other live rooms</Link>
                  </Button>
                </StateCard>
              );
            }
            if (room.status === "idle") {
              return (
                <StateCard testId="live-idle-state">
                  <StageNote
                    icon={<Info className="size-6" />}
                    title="The host hasn't gone live yet"
                    body="This room exists, but no broadcast has started. This page refreshes itself — the stream will appear when the host goes live."
                  />
                </StateCard>
              );
            }

            // ── room.status === "live" → token + transport states ──
            if (mintFailureForSession) {
              const code = mintFailureForSession.code;
              if (code === "provider-not-configured") {
                return (
                  <div className="py-2" data-testid="live-provider-error">
                    <Alert>
                      <Info aria-hidden />
                      <AlertTitle>Live video isn't connected on this deployment yet</AlertTitle>
                      <AlertDescription>
                        <p>
                          This WebFlix deployment hasn&apos;t connected its live video provider
                          yet. Rooms, sessions and viewers already exist — but playback can&apos;t
                          start until the operator connects one. There&apos;s nothing wrong with
                          your account or this room.
                        </p>
                      </AlertDescription>
                    </Alert>
                  </div>
                );
              }
              if (code === "unauthenticated") {
                return (
                  <div className="py-2" data-testid="live-token-unauthenticated">
                    <Alert>
                      <LogIn aria-hidden />
                      <AlertTitle>Sign in to watch</AlertTitle>
                      <AlertDescription>
                        <p>
                          WebFlix LIVE rooms need a signed-in account to join the audience — the
                          room itself is visible, playback isn&apos;t.
                        </p>
                        <Button asChild size="sm" className="mt-1">
                          <Link href={`/signin?redirect=${encodeURIComponent(`/live/${roomId}`)}`}>
                            <LogIn aria-hidden /> Sign in
                          </Link>
                        </Button>
                      </AlertDescription>
                    </Alert>
                  </div>
                );
              }
              if (code === "conflict") {
                return (
                  <div className="py-2" data-testid="live-token-conflict">
                    <Alert>
                      <Info aria-hidden />
                      <AlertTitle>This stream isn&apos;t live right now</AlertTitle>
                      <AlertDescription>
                        <p>
                          The room says &quot;live&quot;, but there&apos;s no active broadcast
                          session to join — it may have just ended. The room state below is
                          refreshed from the server.
                        </p>
                        <Button variant="outline" size="sm" onClick={reloadRoom} className="mt-1">
                          <RefreshCw aria-hidden /> Refresh room state
                        </Button>
                      </AlertDescription>
                    </Alert>
                  </div>
                );
              }
              return (
                <div className="py-2" data-testid="live-token-error">
                  <Alert variant="destructive">
                    <TriangleAlert aria-hidden />
                    <AlertTitle>
                      {code === "rate-limited"
                        ? "Too many join attempts"
                        : "Couldn't start playback"}
                    </AlertTitle>
                    <AlertDescription>
                      <p>
                        {code === "rate-limited"
                          ? "WebFlix is rate-limiting playback tokens right now — wait a moment before retrying."
                          : `Playback failed (${code}).${mintFailureForSession.message ? ` ${mintFailureForSession.message}` : ""}`}
                      </p>
                      <Button variant="outline" size="sm" onClick={retryPlayback} className="mt-1">
                        <RefreshCw aria-hidden /> Retry
                      </Button>
                    </AlertDescription>
                  </Alert>
                </div>
              );
            }

            if (showTransportError) {
              return (
                <div className="py-2" data-testid="live-connect-error">
                  <Alert variant="destructive">
                    <TriangleAlert aria-hidden />
                    <AlertTitle>Live connection trouble</AlertTitle>
                    <AlertDescription>
                      <p>{transportError}</p>
                      <p className="text-xs">
                        Retry mints a fresh short-lived playback token — the old one is discarded.
                      </p>
                      <Button variant="outline" size="sm" onClick={retryPlayback} className="mt-1">
                        <RefreshCw aria-hidden /> Retry playback
                      </Button>
                    </AlertDescription>
                  </Alert>
                </div>
              );
            }

            if (activePlayback && room.status === "live") {
              const isGuestRung = activePlayback.role === "guest";
              return (
                <div
                  data-testid="live-stage"
                  className="relative aspect-video w-full overflow-hidden bg-black sm:rounded-xl"
                >
                  <LiveKitRoom
                    key={activePlayback.token}
                    serverUrl={activePlayback.url}
                    token={activePlayback.token}
                    connect={true}
                    // Viewer rung: subscribe-only (no capture). Guest rung:
                    // audio+video auto-publish — consent happened at the
                    // explicit accept step that minted this token.
                    audio={isGuestRung}
                    video={isGuestRung}
                    screen={false}
                    options={{ adaptiveStream: true, dynacast: true }}
                    onConnected={() => setTransportError(null)}
                    onDisconnected={onTransportDisconnected}
                    onError={onTransportError}
                    className="flex h-full w-full"
                  >
                    {isGuestRung ? (
                      <GuestStage hostName={room.hostName} />
                    ) : (
                      <ViewerStage hostName={room.hostName} />
                    )}
                    <RoomAudioRenderer />
                  </LiveKitRoom>
                </div>
              );
            }

            // minting / waiting → honest connecting skeleton
            return (
              <div aria-busy="true" data-testid="live-stage-loading">
                <div className="flex aspect-video w-full items-center justify-center bg-black sm:rounded-xl">
                  <StageNote
                    icon={<Loader2 className="size-6 animate-spin" />}
                    title="Joining the live room…"
                    body="Minting a short-lived, subscribe-only playback token."
                  />
                </div>
              </div>
            );
          })()}
        </main>

        {/* ── About / session column ───────────────────────────────────── */}
        <aside className="space-y-4">
          {!room ? (
            <div className="space-y-2">
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </div>
          ) : (
            <>
              {sessionLive && (
                <LiveReactionRail
                  roomId={roomId}
                  sessionLive={sessionLive}
                  reactionsEnabled={room.policy?.reactionsEnabled ?? true}
                  signedIn={user !== null}
                  streamReactionTotal={stream.reactionTotal?.total ?? null}
                />
              )}

              {match && <LiveMatchPanel match={match} />}

              {/* ── Phase 3 guest surface: the caller's invite/request state ── */}
              {sessionLive && room.policy?.actorRole === "viewer" && user !== null && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Join the stage</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {myInvite ? (
                      myInvite.direction === "host-invite" ? (
                        <div className="space-y-2">
                          <p>The host invited you to join the stage as a guest.</p>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => void joinStageAsGuest()}
                              disabled={inviteBusy}
                            >
                              Accept &amp; publish camera
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void respondMyInvite("decline")}
                              disabled={inviteBusy}
                            >
                              Decline
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-muted-foreground">
                          Your guest request was sent — waiting for the host.
                        </p>
                      )
                    ) : (room.policy?.guestsEnabled ?? true) &&
                      (stage?.participants.filter((p) => p.role === "guest" && p.state !== "removed")
                        .length ?? 0) < (stage?.guestsMax ?? 4) ? (
                      <div className="space-y-2">
                        <p className="text-muted-foreground">
                          Ask {room.hostName} to bring you on stage as a guest (camera + mic).
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void requestGuestSlot()}
                          disabled={inviteBusy}
                        >
                          Request to join
                        </Button>
                      </div>
                    ) : (
                      <p className="text-muted-foreground">
                        {(room.policy?.guestsEnabled ?? true)
                          ? "The stage is full right now."
                          : "The host turned guest joins off for this room."}
                      </p>
                    )}
                    {inviteError && (
                      <p role="alert" className="text-xs text-destructive">
                        {inviteError}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              <LiveChatPanel
                roomId={roomId}
                sessionLive={sessionLive}
                policy={room.policy ?? null}
                canModerate={canModerate}
                signedIn={user !== null}
                stream={stream}
              />

              <LivePollsQuestions
                roomId={roomId}
                sessionLive={sessionLive}
                canModerate={canModerate}
                signedIn={user !== null}
                streamConnected={stream.connected}
                envelope={stream.latestEnvelope}
              />

              {stage && <LiveStageGrid stage={stage} />}

              <LiveGiftPanel
                catalogue={catalogue}
                gifts={gifts}
                canSend={sessionLive && user !== null && (room.policy?.giftsEnabled ?? true)}
                disabledReason={
                  !sessionLive
                    ? "Gifts open when the broadcast is live"
                    : user === null
                      ? "Sign in to send gifts"
                      : room.policy?.giftsEnabled === false
                        ? "Gifts are off in this room"
                        : null
                }
                sending={giftSending}
                error={giftError}
                onSend={(input) => void sendGift(input)}
                activeMatchTeams={
                  match && match.status === "active"
                    ? match.teams.map((t) => ({ id: t.id, label: t.label }))
                    : []
                }
              />

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Host</CardTitle>
                </CardHeader>
                <CardContent className="flex items-center gap-3">
                  <HostInitial handle={room.hostHandle} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{room.hostName}</p>
                    <p className="truncate text-xs text-muted-foreground">@{room.hostHandle}</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">This session</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Room state</span>
                    <span className="font-medium capitalize">{room.status}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Session state</span>
                    <span className="font-medium">
                      {room.currentSession ? (
                        <span className="capitalize">
                          {room.currentSession.status}
                        </span>
                      ) : (
                        "none yet"
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Viewers</span>
                    <span className="font-medium">
                      ≈ {formatCount(room.viewerCount)}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        (approx.)
                      </span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Created</span>
                    <span className="font-medium">{formatRelativeDate(room.createdAt)}</span>
                  </div>
                  {room.currentSession && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Transport</span>
                      <span className="font-medium capitalize">
                        {room.currentSession.provider}
                      </span>
                    </div>
                  )}
                  {sessionLive && activePlayback && (
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-muted-foreground">Your access</span>
                      <span className="max-w-[60%] text-right font-medium">
                        subscribe-only
                        <span className="block text-xs font-normal text-muted-foreground">
                          you receive audio &amp; video — publishing isn&apos;t possible for
                          viewers
                        </span>
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>

              <p className="px-1 text-xs leading-relaxed text-muted-foreground/80">
                WebFlix LIVE is first-party: rooms, chat, reactions, polls and counts belong to
                WebFlix. Viewer counts are approximate and never a billing fact.
              </p>
            </>
          )}
        </aside>
      </div>

      <Separator className="mt-8" />
      <p className="mt-3 text-xs text-muted-foreground/70">
        Playback uses a short-lived subscribe-only token minted for this browser session — it
        never appears in the page URL.
      </p>
    </div>
  );
}
