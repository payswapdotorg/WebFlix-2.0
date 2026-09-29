"use client";

/**
 * WFX2-A-S — useLiveChat: the client-side driver for the watch-page live
 * chat panel. All data flows through GET /api/videos/[id]/livechat (never
 * youtube.com from the client):
 *
 *   bootstrap : /api/videos/{id}/livechat
 *   live poll : /api/videos/{id}/livechat?token=<nextToken>&mode=live
 *   replay    : /api/videos/{id}/livechat?token=<nextToken>&mode=replay
 *
 * Behavior:
 * - LIVE: setTimeout chain (no setInterval); each next poll is scheduled
 *   from the frame's own `pollMs` clamped to [10s, 60s]. On error the delay
 *   backs off multiplicatively (pollMs*2 capped 60s) and resets on success.
 * - REPLAY: no timed polling. Extra frames are fetched only when the
 *   caller's `currentTimeSec` moves past the newest fetched `offsetMsec`
 *   (ties chat to the player playhead; one fetch per advance, guarded by
 *   an in-flight ref).
 * - Messages are appended deduped by id and capped at ~500 (oldest dropped).
 * - The videoId change reset follows the guarded render-phase pattern of
 *   src/hooks/use-api.ts (adjust state during render, not in an effect).
 * - "loading" is DERIVED from the internal "boot" phase (a bootstrap fetch
 *   is in flight) instead of being set inside the effect body, which would
 *   trip react-hooks/set-state-in-effect.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveChatMessageDTO, LiveChatMode } from "@/lib/youtube/livechat";

export type LiveChatHookState =
  | "boot"
  | "loading"
  | "live"
  | "replay"
  | "unavailable"
  | "error";

/**
 * Envelope returned by /api/videos/[id]/livechat (bootstrap + advance
 * frames — the DTO itself lives in @/lib/youtube/livechat; only the HTTP
 * envelope fields added by the route are declared here).
 */
type LiveChatResponse = {
  chatAvailable?: boolean;
  reason?: string;
  mode?: LiveChatMode;
  messages?: LiveChatMessageDTO[];
  nextToken?: string | null;
  pollMs?: number;
  isReplay?: boolean;
  participants?: number | null;
  skippedActions?: number;
  skippedKinds?: string[];
  seek?: { requestedOffsetSec: number; calls: number; reached: boolean };
};

export type UseLiveChatResult = {
  state: LiveChatHookState;
  messages: LiveChatMessageDTO[];
  participants: number | null;
  pollMs: number;
  nextToken: string | null;
  error: string | null;
  topChat: boolean;
  setTopChat: (v: boolean) => void;
  visibleMessages: LiveChatMessageDTO[];
  refresh: () => void;
};

const MAX_MESSAGES = 500;
const MIN_POLL_MS = 10_000;
const MAX_POLL_MS = 60_000;
const BOOTSTRAP_RETRY_MS = 2_000;
const BOOTSTRAP_RETRY_MAX_MS = 30_000;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `HTTP ${res.status}`;
}

export function useLiveChat(
  videoId: string,
  opts?: { initialMode?: LiveChatMode; currentTimeSec?: number },
): UseLiveChatResult {
  const initialMode = opts?.initialMode;
  const currentTimeSec = opts?.currentTimeSec;

  const [state, setState] = useState<LiveChatHookState>("boot");
  const [messages, setMessages] = useState<LiveChatMessageDTO[]>([]);
  const [participants, setParticipants] = useState<number | null>(null);
  const [pollMs, setPollMs] = useState<number>(MIN_POLL_MS);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [topChat, setTopChat] = useState(false);
  const [tick, setTick] = useState(0);
  const [prevVideoId, setPrevVideoId] = useState(videoId);

  // Adjust state when the video changes (guarded render-phase reset —
  // the use-api.ts pattern). topChat is a user preference and persists.
  if (videoId !== prevVideoId) {
    setPrevVideoId(videoId);
    setState("boot");
    setMessages([]);
    setParticipants(null);
    setPollMs(MIN_POLL_MS);
    setNextToken(null);
    setError(null);
    setTick(0);
  }

  // Loop bookkeeping kept in refs (stable across renders, not deps).
  const tokenRef = useRef<string | null>(null);
  const modeRef = useRef<LiveChatMode>(initialMode ?? "live");
  const pollMsRef = useRef<number>(MIN_POLL_MS);
  const backoffRef = useRef<number>(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  /** Append a frame's messages, deduped by id, capped at MAX_MESSAGES. */
  const mergeMessages = useCallback((frame: LiveChatMessageDTO[]) => {
    if (frame.length === 0) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const fresh = frame.filter((m) => !seen.has(m.id));
      if (fresh.length === 0) return prev;
      const merged = [...prev, ...fresh];
      return merged.length > MAX_MESSAGES
        ? merged.slice(merged.length - MAX_MESSAGES)
        : merged;
    });
  }, []);

  /** Fold a fetched frame into state (token/mode/pollMs/messages). */
  const applyFrame = useCallback(
    (frame: LiveChatResponse) => {
      mergeMessages(frame.messages ?? []);
      tokenRef.current = frame.nextToken ?? null;
      setNextToken(frame.nextToken ?? null);
      if (frame.mode) modeRef.current = frame.mode;
      if (typeof frame.pollMs === "number" && frame.pollMs > 0) {
        pollMsRef.current = frame.pollMs;
        setPollMs(frame.pollMs);
      }
      setParticipants(frame.participants ?? null);
      setError(null);
      const next: LiveChatMode =
        frame.mode ?? (frame.isReplay ? "replay" : "live");
      setState(next === "replay" ? "replay" : "live");
    },
    [mergeMessages],
  );

  // --- bootstrap + LIVE poll loop (one effect per videoId/refresh) --------
  useEffect(() => {
    tokenRef.current = null;
    modeRef.current = initialMode ?? "live";
    pollMsRef.current = MIN_POLL_MS;
    backoffRef.current = 1;
    inFlightRef.current = false;

    const controller = new AbortController();
    abortRef.current = controller;
    const signal = controller.signal;
    let alive = true;

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const schedule = (ms: number) => {
      if (!alive || modeRef.current !== "live") return;
      clearTimer();
      timerRef.current = setTimeout(
        () => void poll(),
        clamp(ms, MIN_POLL_MS, MAX_POLL_MS),
      );
    };

    const poll = async () => {
      if (!alive || inFlightRef.current) return;
      const token = tokenRef.current;
      if (!token) return; // continuation exhausted → stop polling
      inFlightRef.current = true;
      try {
        // always pass the mode the previous frame reported (the server
        // auto-falls-back live→replay only when the mode is omitted)
        const url = `/api/videos/${encodeURIComponent(videoId)}/livechat?token=${encodeURIComponent(token)}&mode=${modeRef.current}`;
        const res = await fetch(url, { cache: "no-store", signal });
        if (!res.ok) throw new Error(await errorMessage(res));
        const frame = (await res.json()) as LiveChatResponse;
        if (!alive || signal.aborted) return;
        applyFrame(frame);
        backoffRef.current = 1; // reset on success
        if (frame.mode !== "replay" && frame.nextToken) {
          schedule(frame.pollMs && frame.pollMs > 0 ? frame.pollMs : pollMsRef.current);
        }
      } catch (err) {
        if (!alive || signal.aborted) return;
        setError(err instanceof Error ? err.message : "Live chat failed");
        setState("error");
        // multiplicative backoff: pollMs*2 … capped at 60s
        schedule(pollMsRef.current * backoffRef.current * 2);
        backoffRef.current = Math.min(backoffRef.current * 2, 8);
      } finally {
        inFlightRef.current = false;
      }
    };

    const bootstrap = async () => {
      if (!alive || inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const url = `/api/videos/${encodeURIComponent(videoId)}/livechat`;
        const res = await fetch(url, { cache: "no-store", signal });
        if (!res.ok) throw new Error(await errorMessage(res));
        const frame = (await res.json()) as LiveChatResponse;
        if (!alive || signal.aborted) return;
        if (frame.chatAvailable === false) {
          // no chat for this video → the panel self-hides
          setError(frame.reason ?? null);
          setState("unavailable");
          return;
        }
        applyFrame(frame);
        backoffRef.current = 1;
        if (frame.mode !== "replay" && frame.nextToken) {
          schedule(frame.pollMs && frame.pollMs > 0 ? frame.pollMs : MIN_POLL_MS);
        }
        // replay mode: no timed polling — the advance effect below drives
        // the fetches from the caller's currentTimeSec
      } catch (err) {
        if (!alive || signal.aborted) return;
        setError(err instanceof Error ? err.message : "Live chat failed");
        setState("error");
        // bootstrap errors: retry with backoff (2s → 30s)
        clearTimer();
        timerRef.current = setTimeout(
          () => void bootstrap(),
          clamp(BOOTSTRAP_RETRY_MS * backoffRef.current, BOOTSTRAP_RETRY_MS, BOOTSTRAP_RETRY_MAX_MS),
        );
        backoffRef.current = Math.min(backoffRef.current * 2, 16);
      } finally {
        inFlightRef.current = false;
      }
    };

    void bootstrap();

    return () => {
      alive = false;
      clearTimer();
      controller.abort();
    };
  }, [videoId, tick, initialMode, applyFrame, mergeMessages]);

  // --- REPLAY advance: fetch the next frame when the playhead passes the
  // newest fetched offset. No timer; one fetch per advance, double-fetch
  // guarded by inFlightRef; re-fires as messages/state settle so the chat
  // catches up to the playhead (bounded by the server's frames).
  useEffect(() => {
    if (state !== "replay") return;
    if (currentTimeSec === undefined) return; // no playhead → first frame only
    if (inFlightRef.current) return;
    if (!nextToken) return; // replay exhausted

    const maxOffsetMsec = messages.reduce(
      (max, m) => Math.max(max, m.offsetMsec ?? 0),
      0,
    );
    if (currentTimeSec * 1000 <= maxOffsetMsec) return;

    const controller = abortRef.current; // aborted on videoId/refresh change
    if (!controller) return;
    const signal = controller.signal;
    inFlightRef.current = true;

    void (async () => {
      try {
        const url = `/api/videos/${encodeURIComponent(videoId)}/livechat?token=${encodeURIComponent(nextToken)}&mode=replay`;
        const res = await fetch(url, { cache: "no-store", signal });
        if (!res.ok) throw new Error(await errorMessage(res));
        const frame = (await res.json()) as LiveChatResponse;
        if (signal.aborted) return;
        applyFrame(frame); // state stays "replay"; token/mode roll forward
      } catch (err) {
        if (signal.aborted) return;
        // surfaced as an inline banner; retried on the next playhead advance
        setError(err instanceof Error ? err.message : "Chat replay failed");
      } finally {
        inFlightRef.current = false;
      }
    })();
  }, [state, currentTimeSec, nextToken, messages, videoId, applyFrame]);

  /**
   * "Top chat" toggle — client-side approximation.
   *
   * NOTE: YouTube's real top-chat filter is SERVER-CURATED (ranking on
   * signals we do not have logged out). This approximation only hides the
   * obvious noise: "system" kind messages, empty text bodies, and authors
   * whose last 3+ messages within the current window are identical
   * (copy-paste spam / muted-author pattern).
   */
  const visibleMessages = useMemo(() => {
    if (!topChat) return messages;

    // newest → oldest: count each author's trailing run of identical bodies
    const hidden = new Set<string>();
    const tails = new Map<string, { body: string; run: number }>();
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      const tail = tails.get(m.author.id);
      if (tail && tail.body === m.body) {
        tail.run += 1;
      } else {
        tails.set(m.author.id, { body: m.body, run: 1 });
      }
      if ((tails.get(m.author.id)?.run ?? 0) >= 3) hidden.add(m.id);
    }

    return messages.filter((m) => {
      if (m.kind === "system") return false;
      // structured kinds (superchat/sticker/milestone/banner) carry their
      // own content; the empty-body rule applies to plain text only
      if (m.kind === "text" && !m.body.trim()) return false;
      return !hidden.has(m.id);
    });
  }, [messages, topChat]);

  /** Re-bootstrap (aborts in-flight requests, dedupes on merge). */
  const refresh = useCallback(() => {
    setError(null);
    setState("boot"); // re-enter the bootstrap phase (surfaced as "loading")
    setTick((t) => t + 1);
  }, []);

  // internal "boot" = a bootstrap fetch for this video is in flight →
  // surfaced to callers as "loading" (derived, not set in the effect body)
  const exposedState: LiveChatHookState = state === "boot" ? "loading" : state;

  return {
    state: exposedState,
    messages,
    participants,
    pollMs,
    nextToken,
    error,
    topChat,
    setTopChat,
    visibleMessages,
    refresh,
  };
}
