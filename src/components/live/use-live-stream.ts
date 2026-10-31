"use client";

/**
 * WFX2-LIVE-PLATFORM-1 Phase 2 — Worker 2-d (UI lane): the client-side
 * realtime stream hook plus the tiny typed HTTP helpers every LIVE
 * interaction surface in this lane shares.
 *
 * SSE contract (ADR-0006, GET /api/live-rooms/[id]/stream):
 * - every frame is `data: <LiveStreamEvent JSON>`; envelopes carry an
 *   `eventId` dedupe key and delivery is at-least-once, so the hook
 *   dedupes by eventId AND (chat) by the strict `seq` cursor;
 * - on `error` the browser would auto-reconnect with the SAME (stale)
 *   URL — instead the hook closes the source and recreates it after a
 *   1s backoff with the UPDATED chat cursor, so the replay covers
 *   exactly the gap that was missed;
 * - `connected` is honest: true only while an EventSource is actually
 *   open, false the moment it drops.
 *
 * Room events re-publish the freshest room snapshot; the hook does NOT
 * own room state — it signals `opts.onRoomChange` so the page can
 * re-fetch. Poll/question/moderation envelopes are forwarded untouched
 * via `opts.onEnvelope` so the polls panel can manage its own list.
 */

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  LiveApiError,
  LiveChatMessageDto,
  LiveReactionTotalDto,
  LiveStreamEvent,
} from "@/lib/live/types";

export interface UseLiveStreamOptions {
  /** Called when a `room` envelope arrives — the page re-fetches room state. */
  onRoomChange?: () => void;
  /** Every parsed envelope, after hook-internal handling (polls panel feed). */
  onEnvelope?: (event: LiveStreamEvent) => void;
}

export interface UseLiveStreamResult {
  /** Chat rows ordered by seq asc, in-memory cap 200 (oldest dropped). */
  messages: LiveChatMessageDto[];
  /** Latest server-computed cumulative reaction total (null until seen). */
  reactionTotal: LiveReactionTotalDto | null;
  /** Approximate viewer count from presence events (null until seen). */
  viewerCount: number | null;
  /** True only while the EventSource is open. */
  connected: boolean;
  /** The latest accepted envelope (identity changes per event) — panels
   * that need non-chat events watch THIS instead of owning a connection. */
  latestEnvelope: LiveStreamEvent | null;
}

const MESSAGE_CAP = 200;
const EVENT_ID_CAP = 600;
const RECONNECT_BACKOFF_MS = 1_000;

/** At-least-once delivery: remember an eventId, false when already seen. */
function rememberEventId(seen: Set<string>, id: string): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  if (seen.size > EVENT_ID_CAP) {
    // Set iterates in insertion order — drop the oldest half.
    let drop = seen.size - EVENT_ID_CAP / 2;
    for (const key of seen) {
      seen.delete(key);
      drop -= 1;
      if (drop <= 0) break;
    }
  }
  return true;
}

/** Replace-by-id (tombstones/edits) or append, then cap at MESSAGE_CAP. */
function appendChatMessage(
  prev: LiveChatMessageDto[],
  message: LiveChatMessageDto,
): LiveChatMessageDto[] {
  const next = prev.some((p) => p.id === message.id)
    ? prev.map((p) => (p.id === message.id ? message : p))
    : [...prev, message];
  return next.length > MESSAGE_CAP ? next.slice(next.length - MESSAGE_CAP) : next;
}

export function useLiveStream(
  roomId: string | null,
  opts?: UseLiveStreamOptions,
): UseLiveStreamResult {
  const [messages, setMessages] = useState<LiveChatMessageDto[]>([]);
  const [reactionTotal, setReactionTotal] = useState<LiveReactionTotalDto | null>(null);
  const [viewerCount, setViewerCount] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [latestEnvelope, setLatestEnvelope] = useState<LiveStreamEvent | null>(null);

  // Latest callbacks without resubscribing the EventSource on every render.
  const optsRef = useRef<UseLiveStreamOptions | undefined>(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  // Per-room mutable stream state: the seq cursor + the eventId memory.
  const lastSeqRef = useRef(0);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Room change → fresh memory (the React-documented render-phase state
  // adjustment: guarded by the previous value, never an effect).
  const [streamedRoomId, setStreamedRoomId] = useState(roomId);
  if (roomId !== streamedRoomId) {
    setStreamedRoomId(roomId);
    setMessages([]);
    setReactionTotal(null);
    setViewerCount(null);
    setConnected(false);
    setLatestEnvelope(null);
  }

  useEffect(() => {
    if (!roomId) return;

    // A new room starts with a fresh cursor + dedupe memory — nothing
    // bleeds across rooms (refs are written here, never during render).
    lastSeqRef.current = 0;
    seenIdsRef.current = new Set();

    let disposed = false;
    let backoffTimer: ReturnType<typeof setTimeout> | null = null;
    let source: EventSource | null = null;

    const handleFrame = (raw: string): void => {
      let event: LiveStreamEvent;
      try {
        event = JSON.parse(raw) as LiveStreamEvent;
      } catch {
        return; // a malformed frame is dropped, never turned into fake state
      }
      if (event === null || typeof event !== "object") return;
      if (typeof event.eventId !== "string" || typeof event.kind !== "string") return;
      if (!rememberEventId(seenIdsRef.current, event.eventId)) return;
      setLatestEnvelope(event);

      switch (event.kind) {
        case "chat": {
          const m = event.message;
          if (!m || typeof m.seq !== "number" || typeof m.id !== "string") break;
          // Tombstones replace/append as-is (they may re-deliver an old seq);
          // live chat appends strictly after the last seen seq.
          if (m.deleted || m.seq > lastSeqRef.current) {
            if (m.seq > lastSeqRef.current) lastSeqRef.current = m.seq;
            setMessages((prev) => appendChatMessage(prev, m));
          }
          break;
        }
        case "reaction":
          if (event.total && typeof event.total.total === "number") {
            setReactionTotal(event.total);
          }
          break;
        case "presence":
          if (event.presence && typeof event.presence.viewerCount === "number") {
            setViewerCount(event.presence.viewerCount);
          }
          break;
        case "room":
          // The page owns room state — it re-fetches on this signal.
          optsRef.current?.onRoomChange?.();
          break;
        default:
          break;
      }

      // Poll/question/moderation consumers tap the raw envelope.
      optsRef.current?.onEnvelope?.(event);
    };

    const connect = (): void => {
      if (disposed) return;
      const params = new URLSearchParams();
      if (lastSeqRef.current > 0) params.set("chatCursor", String(lastSeqRef.current));
      const query = params.toString();
      source = new EventSource(`/api/live-rooms/${roomId}/stream${query ? `?${query}` : ""}`);
      source.onopen = () => {
        if (!disposed) setConnected(true);
      };
      source.onmessage = (ev: MessageEvent<string>) => {
        if (!disposed) handleFrame(ev.data);
      };
      source.onerror = () => {
        if (disposed) return;
        // Honest connection state, then recreate with the UPDATED cursor so
        // the replay after a drop covers exactly the missed gap.
        setConnected(false);
        source?.close();
        source = null;
        backoffTimer = setTimeout(connect, RECONNECT_BACKOFF_MS);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (backoffTimer !== null) clearTimeout(backoffTimer);
      source?.close();
      source = null;
      setConnected(false);
    };
  }, [roomId]);

  return { messages, reactionTotal, viewerCount, connected,
    latestEnvelope,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Shared typed HTTP helpers for the LIVE interaction surfaces.
// ═══════════════════════════════════════════════════════════════════

/** The honest failure a LIVE route (or the network) can hand back. */
export type LiveHttpFailure = {
  status: number;
  code: LiveApiError["error"] | "network";
  message?: string;
};

export type LiveHttpResult<T> =
  | { ok: true; data: T }
  | { ok: false; failure: LiveHttpFailure };

/**
 * JSON fetch against the frozen LIVE route contract. Never throws —
 * every failure (including network) comes back as a typed failure so
 * callers can render honest states instead of crashing.
 */
export async function liveFetch<T>(
  url: string,
  init: { method?: "GET" | "POST" | "DELETE"; body?: unknown; signal?: AbortSignal } = {},
): Promise<LiveHttpResult<T>> {
  try {
    const res = await fetch(url, {
      method: init.method ?? "POST",
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: init.signal,
    });
    const json = (await res.json().catch(() => ({}))) as T & Partial<LiveApiError>;
    if (!res.ok) {
      const code: LiveApiError["error"] | "network" = json.error ?? "network";
      return {
        ok: false,
        failure: { status: res.status, code, message: json.message },
      };
    }
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, failure: { status: 0, code: "network" } };
  }
}

/** One honest toast per LiveApiError shape, with a caller fallback line. */
export function toastLiveFailure(failure: LiveHttpFailure, fallback: string): void {
  const detail = failure.message && failure.message.length > 0 ? failure.message : undefined;
  switch (failure.code) {
    case "rate-limited":
      toast.error("You're doing that too fast", {
        description: "WebFlix rate-limited this action — wait a moment and retry.",
      });
      return;
    case "unauthenticated":
      toast.error("You're signed out", {
        description: "Sign in again to continue — nothing was changed.",
      });
      return;
    case "forbidden":
      toast.error(detail ?? "You're not allowed to do that here.");
      return;
    case "not-found":
      toast.error("That's gone", {
        description: detail ?? "The room, message or item no longer exists.",
      });
      return;
    case "network":
      toast.error("Couldn't reach WebFlix", {
        description: `${fallback} Check your connection and retry.`,
      });
      return;
    default:
      toast.error(detail ?? fallback);
  }
}

/**
 * The presence heartbeat (Phase 2): POST /presence every 15s while active.
 * Keeps the caller's participant row inside the freshness window so the
 * approximate viewer count stays honest; a closed tab simply decays out.
 */
export function useLivePresence(roomId: string | null, active: boolean): void {
  useEffect(() => {
    if (!roomId || !active) return;
    const beat = () => {
      void fetch(`/api/live-rooms/${roomId}/presence`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        keepalive: true,
      }).catch(() => {
        // a failed heartbeat is silent — the count decays, it never lies
      });
    };
    beat();
    const timer = setInterval(beat, 15_000);
    return () => clearInterval(timer);
  }, [roomId, active]);
}
