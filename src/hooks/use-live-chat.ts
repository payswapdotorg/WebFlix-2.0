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
 *
 * WFX2-C-S — REPLAY SEEKING (youtube.com behavior):
 * Every playhead jump is classified by the pure planReplaySeek() (±1s
 * youtube.com tolerance):
 * - BACKWARD seek → future messages are dropped INSTANTLY (render-phase,
 *   the panel reveal-gating hides them the same frame) and the chat
 *   re-anchors: re-bootstrap from the session-start token with
 *   `?replayOffsetSec=<target>` (the server walks the continuation chain —
 *   ZERO server/DTO changes, the existing walk is reused).
 * - FORWARD leap past the fetched window + 10s grace → a walk fetch from
 *   the CURRENT token: `?token=<t>&mode=replay&replayOffsetSec=<target>`.
 * - Forward in-window (and ≤ window+10s) → "reveal": no fetch; the panel
 *   gates visibility by offsetMsec <= playhead.
 * Scrub drags coalesce (newest intent wins — each intent bumps a seq,
 * aborts in-flight fetches and supersedes pending walk intents); stale
 * advance-frames captured before a seek are DISCARDED on arrival (dropSeq
 * guard) so an old window can never land on top of a re-anchored one.
 * The chat freezes while the player is paused (currentTimeSec stops —
 * no intents, no advance) and catches up on resume.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LiveChatMessageDTO, LiveChatMode } from "@/lib/youtube/livechat";
import {
  keepMessagesAtOrBelow,
  planReplaySeek,
  replayWindowFrom,
} from "@/lib/watch/replay-seek";

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
  /** A seek-triggered fetch (re-anchor or leap-walk) is in flight. */
  seeking: boolean;
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

  // --- WFX2-C-S seek state ------------------------------------------------
  /** Playhead at the previous classification (undefined → not yet seen). */
  const [prevTime, setPrevTime] = useState<number | undefined>(undefined);
  /** A seek intent counter; each intent bumps it (scrub coalescing). */
  const [intentSeq, setIntentSeq] = useState(0);
  /** The pending seek intent: re-anchor (bootstrap with offset) or forward
   * leap-walk from the current token. Replaced by newer intents — the
   * newest wins (scrub drags coalesce). */
  const [intent, setIntent] = useState<
    { seq: number; kind: "reanchor" | "walk"; targetSec: number } | null
  >(null);
  /** True while a seek fetch (re-anchor bootstrap or leap-walk) is in flight. */
  const [seeking, setSeeking] = useState(false);

  // Loop bookkeeping kept in refs (stable across renders, not deps —
  // written only from effects/callbacks, never during render).
  const tokenRef = useRef<string | null>(null);
  const modeRef = useRef<LiveChatMode>(initialMode ?? "live");
  const pollMsRef = useRef<number>(MIN_POLL_MS);
  const backoffRef = useRef<number>(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  /** seekSeqRef: bumped by each applied intent; stale frames check it. */
  const seekSeqRef = useRef(0);
  /** Replay offset for the NEXT bootstrap run (re-anchor target). */
  const bootstrapOffsetSecRef = useRef<number | null>(null);
  /** Seq of walk intents already consumed (fetch done or dropped). */
  const walkSeqDoneRef = useRef<number>(-1);
  /** Seq of intents whose side effects have been applied. */
  const appliedIntentRef = useRef(0);

  // Adjust state when the video changes (guarded render-phase reset —
  // the use-api.ts pattern). topChat is a user preference and persists.
  // (Ref resets happen in the effect below — refs are never written in
  // render.)
  if (videoId !== prevVideoId) {
    setPrevVideoId(videoId);
    setState("boot");
    setMessages([]);
    setParticipants(null);
    setPollMs(MIN_POLL_MS);
    setNextToken(null);
    setError(null);
    setTick(0);
    setPrevTime(undefined);
    setIntentSeq(0);
    setIntent(null);
    setSeeking(false);
  }

  // Ref resets on video change (runs before the loop effects below).
  useEffect(() => {
    seekSeqRef.current = 0;
    walkSeqDoneRef.current = -1;
    bootstrapOffsetSecRef.current = null;
    appliedIntentRef.current = 0;
  }, [videoId]);

  // --- WFX2-C-S: render-phase seek classification -------------------------
  // The playhead prop moves → classify the jump (guarded render-phase
  // pattern, same as the videoId reset above). Only replay (or still
  // loading — a seek racing the first frame) is classified; live chat has
  // no offsets. Organic playback advances ~1s/sec → "none". Pure state
  // updates only — the intent's side effects (seq bump, abort, offset
  // latch) run in the intent effect below.
  if (currentTimeSec !== prevTime) {
    const prevHead = prevTime;
    setPrevTime(currentTimeSec);

    const classifyable =
      currentTimeSec !== undefined &&
      prevHead !== undefined &&
      (state === "replay" || state === "loading" || state === "boot");

    if (classifyable) {
      const windowState = replayWindowFrom(messages, nextToken);
      const plan = planReplaySeek(prevHead, currentTimeSec, windowState);
      if (plan.action === "reanchor") {
        // Drop future messages INSTANTLY (the reveal gating hides them
        // this same render; the store drop keeps memory/merge clean).
        setMessages(keepMessagesAtOrBelow(messages, plan.targetSec));
        setIntentSeq((s) => s + 1);
        setIntent({ seq: intentSeq + 1, kind: "reanchor", targetSec: plan.targetSec });
        setSeeking(true);
        // Re-anchor = re-bootstrap from the session-start token with
        // ?replayOffsetSec (the existing server walk).
        setState("boot");
        setTick((t) => t + 1);
      } else if (plan.action === "walk") {
        setIntentSeq((s) => s + 1);
        setIntent({ seq: intentSeq + 1, kind: "walk", targetSec: plan.targetSec });
        setSeeking(true);
      }
      // "reveal" / "none": no fetch — reveal gating handles visibility.
    }
  }

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
      // A landed frame settles any pending seek (re-anchor or walk).
      bootstrapOffsetSecRef.current = null;
      setSeeking(false);
      const next: LiveChatMode =
        frame.mode ?? (frame.isReplay ? "replay" : "live");
      setState(next === "replay" ? "replay" : "live");
    },
    [mergeMessages],
  );

  // --- WFX2-C-S: intent side effects (post-render) -------------------------
  // Each new intent (scrub drags coalesce into the newest seq): bump the
  // dropSeq, abort any in-flight fetch and clear the in-flight latch so
  // the newest intent wins immediately. Runs BEFORE the bootstrap/walk
  // effects (declaration order) so the re-anchor offset is latched before
  // the bootstrap URL is built.
  useEffect(() => {
    if (!intent || intent.seq === appliedIntentRef.current) return;
    appliedIntentRef.current = intent.seq;
    seekSeqRef.current = intent.seq;
    if (intent.kind === "reanchor") {
      // the bootstrap run triggered by the same render consumes this
      bootstrapOffsetSecRef.current = intent.targetSec;
    }
    try {
      abortRef.current?.abort();
    } catch {
      /* already aborted */
    }
    abortRef.current = new AbortController();
    inFlightRef.current = false;
  }, [intent]);

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
        // WFX2-C-S: a re-anchor seek bootstraps with ?replayOffsetSec so
        // the server walks the session-start token to the seek target.
        const offset = bootstrapOffsetSecRef.current;
        const offsetQ =
          offset !== null ? `?replayOffsetSec=${Math.max(0, Math.floor(offset))}` : "";
        const url = `/api/videos/${encodeURIComponent(videoId)}/livechat${offsetQ}`;
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

  // --- WFX2-C-S: forward leap-walk (from the CURRENT token) ---------------
  // Fires for "walk" intents; waits out a bootstrap; drops honestly when
  // live / exhausted / superseded; fetches
  // ?token=<current>&mode=replay&replayOffsetSec=<target>.
  useEffect(() => {
    if (!intent || intent.kind !== "walk") return;
    if (walkSeqDoneRef.current === intent.seq) return; // consumed
    if (seekSeqRef.current !== intent.seq) {
      // superseded by a newer seek intent (scrub coalescing: newest wins)
      walkSeqDoneRef.current = intent.seq;
      return;
    }
    if (state === "live" || state === "unavailable" || state === "error") {
      walkSeqDoneRef.current = intent.seq;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- honest terminal drop: the walk can never land (live/no chat/error); clears the shimmer once
      setSeeking(false);
      return;
    }
    if (state === "boot" || state === "loading") return; // wait for the frame
    if (!nextToken) {
      // replay exhausted — nothing to walk (the video may outlive its chat)
      walkSeqDoneRef.current = intent.seq;
      setSeeking(false);
      return;
    }

    const controller =
      abortRef.current ?? (abortRef.current = new AbortController());
    const signal = controller.signal;
    const seq = intent.seq;
    inFlightRef.current = true;

    void (async () => {
      try {
        const target = Math.max(0, Math.floor(intent.targetSec));
        const url = `/api/videos/${encodeURIComponent(videoId)}/livechat?token=${encodeURIComponent(nextToken)}&mode=replay&replayOffsetSec=${target}`;
        const res = await fetch(url, { cache: "no-store", signal });
        if (!res.ok) throw new Error(await errorMessage(res));
        const frame = (await res.json()) as LiveChatResponse;
        // dropSeq: a newer seek re-anchored while we were in flight → discard
        if (signal.aborted || seekSeqRef.current !== seq) return;
        applyFrame(frame);
      } catch (err) {
        if (signal.aborted || seekSeqRef.current !== seq) return;
        setError(err instanceof Error ? err.message : "Chat replay seek failed");
      } finally {
        walkSeqDoneRef.current = seq;
        inFlightRef.current = false;
      }
    })();
  }, [intent, state, nextToken, videoId, applyFrame]);

  // --- REPLAY advance: fetch the next frame when the playhead passes the
  // newest fetched offset. No timer; one fetch per advance, double-fetch
  // guarded by inFlightRef; re-fires as messages/state settle so the chat
  // catches up to the playhead (bounded by the server's frames).
  // WFX2-C-S: dropSeq — frames captured before a seek intent are discarded.
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
    const seqAtFetch = seekSeqRef.current;
    inFlightRef.current = true;

    void (async () => {
      try {
        const url = `/api/videos/${encodeURIComponent(videoId)}/livechat?token=${encodeURIComponent(nextToken)}&mode=replay`;
        const res = await fetch(url, { cache: "no-store", signal });
        if (!res.ok) throw new Error(await errorMessage(res));
        const frame = (await res.json()) as LiveChatResponse;
        // dropSeq: a seek re-anchored the window while this frame was in
        // flight → applying it would resurrect the abandoned window.
        if (signal.aborted || seekSeqRef.current !== seqAtFetch) return;
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

  /** Re-bootstrap (aborts in-flight requests, dedupes on merge).
   * WFX2-C-S: in replay mode the refresh re-anchors to the CURRENT
   * playhead (the old first-frame bootstrap would regress the window to
   * the stream start and crawl back frame-by-frame). */
  const refresh = useCallback(() => {
    setError(null);
    if (state === "replay" && typeof prevTime === "number" && prevTime > 0) {
      bootstrapOffsetSecRef.current = prevTime;
      setSeeking(true);
    } else {
      bootstrapOffsetSecRef.current = null;
    }
    setState("boot"); // re-enter the bootstrap phase (surfaced as "loading")
    setTick((t) => t + 1);
  }, [state, prevTime]);

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
    seeking,
  };
}
