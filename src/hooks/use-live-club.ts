"use client";

/**
 * WFX2-LIVE-PLATFORM-1 Phase 5 — Lane 5-c (UI lane): useLiveClub — the
 * client driver behind the fan-club surfaces (the viewer room panel and the
 * studio's fan-club manager card).
 *
 * Route law (frozen contracts §5): the hook speaks ONLY
 *   GET  /api/live-clubs/[hostId]      → LiveFanClubOverviewDto
 *   POST /api/live-clubs/[hostId]/join · /leave   (no body, no response read)
 *   POST /api/live-clubs               ← CreateLiveFanClubInput
 * and never invents fields beyond the frozen DTOs (ADR-0010: points/levels
 * are server-derived entertainment facts — the client never claims them).
 *
 * Behavior (the use-api.ts / use-live-stream.ts conventions):
 * - loading is DERIVED (no data & no failure yet) — no setState-in-effect;
 * - the hostId change resets state in the render phase (guarded by the
 *   previous value — the React-documented pattern both hooks use);
 * - a refresh keeps the previous overview on screen until the fresh one
 *   lands (stale-while-revalidate, the useApi shape);
 * - join/leave are OPTIMISTIC INTENTS with rollback: the intent flips the
 *   membership view immediately and a failed POST rolls it back with the
 *   server's honest error copy (a failed action never fakes success). The
 *   optimistic window renders the frozen derivation floor (0 points →
 *   level 1) labelled "syncing…" — the server's overview replaces it the
 *   moment the POST is confirmed (the hook re-fetches on success);
 * - 404 on the overview is NOT an error: it is the honest "this creator
 *   has no fan club yet" empty state (clubMissing).
 */

import { useCallback, useEffect, useState } from "react";
import type {
  CreateLiveFanClubInput,
  LiveApiError,
  LiveFanClubOverviewDto,
} from "@/lib/live/types";

export type LiveClubErrorCode = LiveApiError["error"] | "network";

/** One honest action failure, ready to render. */
export interface LiveClubActionError {
  code: LiveClubErrorCode;
  copy: string;
}

export interface UseLiveClubResult {
  /** True while the FIRST overview fetch for this host is in flight. */
  loading: boolean;
  overview: LiveFanClubOverviewDto | null;
  /** 404 — the host has no club yet (an empty state, not a failure). */
  clubMissing: boolean;
  /** The overview fetch's failure (null when loaded or missing). */
  loadError: LiveClubErrorCode | null;
  loadErrorMessage: string | null;
  /** Re-fetch the overview (also the retry affordance). */
  refresh: () => void;

  /** POST …/join — optimistic intent with rollback. True only on 2xx. */
  join: () => Promise<boolean>;
  /** POST …/leave — optimistic intent with rollback. True only on 2xx. */
  leave: () => Promise<boolean>;
  /** POST /api/live-clubs — creator-only; re-fetches on success. */
  create: (input: CreateLiveFanClubInput) => Promise<boolean>;

  joinBusy: boolean;
  leaveBusy: boolean;
  createBusy: boolean;
  /** The last failed action's honest copy (rendered verbatim or cleared). */
  actionError: LiveClubActionError | null;
  clearActionError: () => void;

  /**
   * The membership view the panel should render — the server's projection
   * when present, the optimistic intent otherwise, null while rolled back.
   * `syncing` marks the optimistic window (the server hasn't confirmed yet).
   */
  visibleMembership: { points: number; level: number; syncing: boolean } | null;
  /** True while a leave intent is in flight (the roster hides the caller). */
  optimisticLeft: boolean;
}

type ClubFailure = { code: LiveClubErrorCode; message: string | null };

/** The honest per-code fallback copy (the server's message wins when present). */
const ACTION_FALLBACK: Record<LiveClubErrorCode, string> = {
  unauthenticated: "Your session ended — sign in again. Nothing was changed.",
  "not-found": "That fan club is gone — nothing was changed.",
  forbidden: "You can't do that here — nothing was changed.",
  conflict: "That didn't go through — nothing was changed.",
  invalid: "That didn't pass WebFlix's club rules — nothing was changed.",
  "provider-not-configured": "This feature isn't connected on this deployment yet.",
  "provider-failed": "WebFlix couldn't complete that — nothing was changed.",
  "rate-limited":
    "You're doing that too fast — wait a moment and retry. Nothing was changed.",
  flagged: "That was flagged by the room's filters — nothing was changed.",
  network: "Couldn't reach WebFlix — nothing was changed. Check your connection and retry.",
};

function actionCopy(failure: ClubFailure): LiveClubActionError {
  const detail = failure.message && failure.message.length > 0 ? failure.message : null;
  return { code: failure.code, copy: detail ?? ACTION_FALLBACK[failure.code] };
}

async function clubFailureOf(res: Response): Promise<ClubFailure> {
  const body = (await res.json().catch(() => ({}))) as Partial<LiveApiError>;
  return { code: body.error ?? "network", message: body.message ?? null };
}

/** POST with no read-back: the hook only needs ok/failure (never invents data). */
async function postClubAction(
  url: string,
  body?: CreateLiveFanClubInput,
): Promise<ClubFailure | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : "{}",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (res.ok) return null;
    return await clubFailureOf(res);
  } catch {
    return { code: "network", message: null };
  }
}

export function useLiveClub(hostId: string | null): UseLiveClubResult {
  const [overview, setOverview] = useState<LiveFanClubOverviewDto | null>(null);
  const [clubMissing, setClubMissing] = useState(false);
  const [loadFailure, setLoadFailure] = useState<ClubFailure | null>(null);
  const [tick, setTick] = useState(0);

  const [joinBusy, setJoinBusy] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [actionError, setActionError] = useState<LiveClubActionError | null>(null);

  // The optimistic intents (rolled back when their POST fails).
  const [optimisticJoined, setOptimisticJoined] = useState(false);
  const [optimisticLeft, setOptimisticLeft] = useState(false);

  // Host change → fresh state in the render phase (the use-api.ts pattern).
  const [prevHostId, setPrevHostId] = useState(hostId);
  if (hostId !== prevHostId) {
    setPrevHostId(hostId);
    setOverview(null);
    setClubMissing(false);
    setLoadFailure(null);
    setActionError(null);
    setOptimisticJoined(false);
    setOptimisticLeft(false);
  }

  // The overview fetch (GET /api/live-clubs/[hostId]). One AbortController
  // per host/tick — a newer fetch owns the truth, an aborted one stays mute.
  useEffect(() => {
    if (!hostId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/live-clubs/${hostId}`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (res.status === 404) {
          // No club for this host — the honest empty state, not a failure.
          setClubMissing(true);
          setOverview(null);
          setLoadFailure(null);
          return;
        }
        if (!res.ok) {
          setLoadFailure(await clubFailureOf(res));
          return;
        }
        const body = (await res
          .json()
          .catch(() => null)) as (LiveFanClubOverviewDto & {
          overview?: LiveFanClubOverviewDto;
        }) | null;
        // Tolerate the optional { overview } envelope without inventing
        // fields: the frozen DTO is the body, a wrapper is unwrapped.
        const next = body?.overview ?? body;
        if (!next || typeof next !== "object" || !next.club) {
          setLoadFailure({ code: "invalid", message: null });
          return;
        }
        setOverview(next);
        setClubMissing(false);
        setLoadFailure(null);
      } catch {
        if (!controller.signal.aborted) {
          setLoadFailure({ code: "network", message: null });
        }
      }
    })();
    return () => controller.abort();
  }, [hostId, tick]);

  const join = useCallback(async (): Promise<boolean> => {
    if (!hostId || joinBusy || optimisticJoined) return false;
    setJoinBusy(true);
    setActionError(null);
    setOptimisticJoined(true); // the intent — rolled back below on failure
    const failure = await postClubAction(`/api/live-clubs/${hostId}/join`);
    if (failure === null) {
      setOptimisticJoined(false);
      setTick((t) => t + 1); // the server's overview replaces the intent
    } else {
      setOptimisticJoined(false); // rollback — the membership view reverts
      setActionError(actionCopy(failure));
    }
    setJoinBusy(false);
    return failure === null;
  }, [hostId, joinBusy, optimisticJoined]);

  const leave = useCallback(async (): Promise<boolean> => {
    if (!hostId || leaveBusy || optimisticLeft) return false;
    setLeaveBusy(true);
    setActionError(null);
    setOptimisticLeft(true); // the intent — rolled back below on failure
    const failure = await postClubAction(`/api/live-clubs/${hostId}/leave`);
    if (failure === null) {
      setOptimisticLeft(false);
      setTick((t) => t + 1); // the server's overview confirms the leave
    } else {
      setOptimisticLeft(false); // rollback — still a member, and told so
      setActionError(actionCopy(failure));
    }
    setLeaveBusy(false);
    return failure === null;
  }, [hostId, leaveBusy, optimisticLeft]);

  const create = useCallback(
    async (input: CreateLiveFanClubInput): Promise<boolean> => {
      if (createBusy) return false;
      setCreateBusy(true);
      setActionError(null);
      const failure = await postClubAction("/api/live-clubs", input);
      if (failure === null) {
        setClubMissing(false);
        setTick((t) => t + 1); // the fresh overview replaces the empty state
      } else {
        setActionError(actionCopy(failure));
      }
      setCreateBusy(false);
      return failure === null;
    },
    [createBusy],
  );

  const refresh = useCallback(() => {
    setLoadFailure(null);
    setTick((t) => t + 1);
  }, []);

  const clearActionError = useCallback(() => setActionError(null), []);

  const loading = hostId !== null && overview === null && !clubMissing && loadFailure === null;

  return {
    loading,
    overview,
    clubMissing,
    loadError: loadFailure?.code ?? null,
    loadErrorMessage: loadFailure?.message ?? null,
    refresh,
    join,
    leave,
    create,
    joinBusy,
    leaveBusy,
    createBusy,
    actionError,
    clearActionError,
    visibleMembership: computeVisibleMembership(overview, optimisticJoined, optimisticLeft),
    optimisticLeft,
  };
}

/** The frozen derivation floor: 0 points → level 1 (level = floor(p/ppl)+1). */
function computeVisibleMembership(
  overview: LiveFanClubOverviewDto | null,
  optimisticJoined: boolean,
  optimisticLeft: boolean,
): { points: number; level: number; syncing: boolean } | null {
  if (optimisticLeft) return null;
  if (overview?.membership) {
    return {
      points: overview.membership.points,
      level: overview.membership.level,
      syncing: false,
    };
  }
  if (optimisticJoined) return { points: 0, level: 1, syncing: true };
  return null;
}
