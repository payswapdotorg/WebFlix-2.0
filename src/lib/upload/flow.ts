/**
 * WFX2-P3-UP — the upload flow's state machine + the typed outcome the
 * /api/upload/execute route returns (pure — the view drives it, the tests walk
 * it; no fetch, no broker import).
 *
 * WFX2-P6-UP — the state gained the wizard's step ladder + the Checks
 * animation state (YouTube's studio upload dialog). Strictly ADDITIVE: the
 * phase names and every existing event keep their exact semantics — the API
 * paths (/api/upload, /stage, /execute) and the honest ladder below are
 * untouched.
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

/**
 * WFX2-P6-UP — the wizard's step ladder (YouTube's studio upload dialog):
 *   0 = the drag-and-drop file target (no dialog yet)
 *   1 = Details (title + description — Next needs a non-empty title)
 *   2 = Video elements (tags + the honest WebFlix/hand-off fields)
 *   3 = Checks (the local file/metadata validation animation)
 *   4 = Visibility (Private/Unlisted/Public cards + Save)
 */
export type UploadWizardStep = 0 | 1 | 2 | 3 | 4;

/** The Checks step's honest animation state — "passed" means the LOCAL
 * validation ran (file + metadata); YouTube's copyright checks never run
 * here and are never claimed to. */
export type UploadChecksState = "idle" | "running" | "passed";

export interface UploadFlowState {
  phase: UploadFlowPhase;
  /** the wizard's current step (P6-UP; 0 until a file is picked) */
  step: UploadWizardStep;
  /** the Checks step's animation state (P6-UP) */
  checks: UploadChecksState;
  fileName: string | null;
  sizeBytes: number | null;
  stageId: string | null;
  result: UploadExecuteResponseDTO | null;
  error: string | null;
}

export function initialUploadFlowState(): UploadFlowState {
  return {
    phase: "idle",
    step: 0,
    checks: "idle",
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
  | { type: "step-next" }
  | { type: "step-back" }
  | { type: "step-jump"; to: UploadWizardStep }
  | { type: "checks-completed" }
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
      // a fresh file opens the dialog at Details (YouTube's behavior) and
      // resets any prior terminal state — a new drive may start
      return {
        ...initialUploadFlowState(),
        step: 1,
        fileName: event.fileName,
        sizeBytes: event.sizeBytes,
      };
    case "file-cleared":
      return initialUploadFlowState();
    case "step-next": {
      const step = Math.min(4, state.step + 1) as UploadWizardStep;
      // stepping INTO Checks starts its animation; other steps keep the state
      return { ...state, step, checks: step === 3 ? "running" : state.checks };
    }
    case "step-back": {
      const step = Math.max(1, state.step - 1) as UploadWizardStep;
      // backing below Checks resets its animation (a re-entry re-runs it)
      return { ...state, step, checks: step < 3 ? "idle" : state.checks };
    }
    case "step-jump": {
      // the header chips jump BACKWARD only (forward needs each step's Next)
      if (event.to < 1 || event.to >= state.step) return state;
      return {
        ...state,
        step: event.to,
        checks: event.to < 3 ? "idle" : state.checks,
      };
    }
    case "checks-completed":
      // the honest auto-advance: the local validation finished → Visibility
      return { ...state, checks: "passed", step: 4 };
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

/** The Publish/Save button's honest gate: a staged-capable file + a
 * non-empty title, from a resting phase (the wizard's Save on the Visibility
 * step rides exactly this rule). */
export function canPublish(state: UploadFlowState, title: string): boolean {
  return (
    state.fileName !== null &&
    state.fileName.trim().length > 0 &&
    title.trim().length > 0 &&
    (state.phase === "idle" || state.phase === "error" || state.phase === "fallback")
  );
}

/** The Details step's honest gate — YouTube refuses to advance without a
 * title; so does the wizard's Next (the disabled button says why). */
export function detailsStepReady(title: string): boolean {
  return title.trim().length > 0;
}

/** The wizard step's display names (the header chips + the a11y labels). */
export const UPLOAD_STEPS: readonly { id: UploadWizardStep; label: string }[] = [
  { id: 1, label: "Details" },
  { id: 2, label: "Video elements" },
  { id: 3, label: "Checks" },
  { id: 4, label: "Visibility" },
];
