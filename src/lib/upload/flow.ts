/**
 * WFX2-P3-UP — the upload flow's state machine + the typed outcome the
 * /api/upload/execute route returns (pure — the view drives it, the tests walk
 * it; no fetch, no broker import).
 *
 * The honest ladder (never a fake success):
 *   idle → staging → executing → published   (broker confirmed the publish —
 *                                             verified, or honestly
 *                                             unverified when the
 *                                             confirmation was not observed)
 *                            → fallback      (broker OFFLINE/unauthorized —
 *                                             the CURRENT hand-off rung
 *                                             carries the user instead)
 *                            → error         (broker REFUSED/failed — the
 *                                             honest stage-accurate message;
 *                                             the hand-off rung is offered)
 */

import type { UploadHandoffDTO } from "@/lib/types";

export type UploadVisibility = "public" | "unlisted" | "private";

/** The /api/upload/execute response body (all flow outcomes answer 200 — the
 * outcome field carries the truth; only request errors are 4xx). */
export interface UploadExecuteResponseDTO {
  outcome: "published" | "fallback" | "error";
  /** the staged drive's honest stage marker ('published' | 'processing' on
   * success; the failure stage — 'dialog' | 'checks' | 'uploading' | … — on
   * error, when the broker reported one) */
  stage?: string;
  /** published: true only when the confirmation was observed in the tab */
  verified?: boolean;
  videoId?: string;
  watchUrl?: string;
  note?: string;
  /** fallback: 'broker-offline' | 'broker-unauthorized'; error: the broker's failure kind */
  reason?: string;
  /** fallback/error: the honest human message */
  message?: string;
  /** fallback/error: the hand-off rung (never a dead end) */
  handoff?: UploadHandoffDTO;
}

export type UploadFlowPhase =
  | "idle"
  | "staging"
  | "executing"
  | "published"
  | "fallback"
  | "error";

export interface UploadFlowState {
  phase: UploadFlowPhase;
  fileName: string | null;
  sizeBytes: number | null;
  stageId: string | null;
  result: UploadExecuteResponseDTO | null;
  error: string | null;
}

export function initialUploadFlowState(): UploadFlowState {
  return {
    phase: "idle",
    fileName: null,
    sizeBytes: null,
    stageId: null,
    result: null,
    error: null,
  };
}

export type UploadFlowEvent =
  | { type: "file-picked"; fileName: string; sizeBytes: number }
  | { type: "file-cleared" }
  | { type: "publish-started" }
  | { type: "stage-succeeded"; stageId: string }
  | { type: "stage-failed"; error: string }
  | { type: "execute-started" }
  | { type: "execute-settled"; result: UploadExecuteResponseDTO }
  | { type: "reset" };

/** Pure transition — the view's single reducer, the tests' walkable ladder. */
export function uploadFlowNext(
  state: UploadFlowState,
  event: UploadFlowEvent
): UploadFlowState {
  switch (event.type) {
    case "file-picked":
      return {
        ...initialUploadFlowState(),
        fileName: event.fileName,
        sizeBytes: event.sizeBytes,
      };
    case "file-cleared":
      return initialUploadFlowState();
    case "publish-started":
      return { ...state, phase: "staging", result: null, error: null };
    case "stage-succeeded":
      return { ...state, phase: "staging", stageId: event.stageId };
    case "stage-failed":
      return {
        ...state,
        phase: "error",
        error: event.error,
        result: null,
      };
    case "execute-started":
      return { ...state, phase: "executing" };
    case "execute-settled": {
      const r = event.result;
      if (r.outcome === "published") return { ...state, phase: "published", result: r };
      if (r.outcome === "fallback") return { ...state, phase: "fallback", result: r };
      return { ...state, phase: "error", result: r, error: r.message ?? "the publish was refused" };
    }
    case "reset":
      return initialUploadFlowState();
  }
}

/** The Publish button's honest gate: a staged-capable file + a non-empty title. */
export function canPublish(state: UploadFlowState, title: string): boolean {
  return (
    state.fileName !== null &&
    state.fileName.trim().length > 0 &&
    title.trim().length > 0 &&
    (state.phase === "idle" || state.phase === "error" || state.phase === "fallback")
  );
}
