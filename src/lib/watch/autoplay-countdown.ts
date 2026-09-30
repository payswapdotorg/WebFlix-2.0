/**
 * WFX2-C-S — watch-next autoplay countdown: the pure state machine.
 *
 * youtube.com behavior mirrored:
 * - ENDED with autoplay ON + a next video → a 5s countdown arms ("counting",
 *   wall-clock deadline). Advance fires ONCE per ENDED cycle (the only
 *   transition to "fired").
 * - RESET on replay/seek-after-ended: PLAYING returns the machine to "idle"
 *   (a re-ENDED then restarts the countdown).
 * - CANCEL (the circular X / Esc / space) → "cancelled": no navigation, and
 *   a spurious re-ENDED cannot re-arm it (only PLAYING unlocks the next
 *   cycle).
 * - AUTOPLAY_OFF mid-count cancels instantly ("cancelled").
 * - No next video (or autoplay already off) at ENDED → never arms.
 * - TICKs are WALL-CLOCK (Date.now), not accumulated intervals, so
 *   background-throttled tabs still advance on time.
 *
 * Pure module — no React, no timers; unit-tested in
 * tests/autoplay-countdown.test.ts.
 */

/** YouTube's autoplay countdown (seconds). */
export const COUNTDOWN_SECONDS = 5;
export const COUNTDOWN_TOTAL_MS = COUNTDOWN_SECONDS * 1000;

export type CountdownStatus = "idle" | "counting" | "fired" | "cancelled";

export type AutoplayCountdownState = {
  status: CountdownStatus;
  /** Wall-clock ms when the countdown ends (null unless counting). */
  endsAt: number | null;
  /** The countdown length the current cycle was armed with (ms). */
  totalMs: number;
};

export const initialCountdown: AutoplayCountdownState = {
  status: "idle",
  endsAt: null,
  totalMs: COUNTDOWN_TOTAL_MS,
};

export type CountdownEvent =
  /** Player ENDED (payload: autoplay pref, whether a next video exists, now). */
  | { type: "ENDED"; autoplay: boolean; hasNext: boolean; now: number }
  /** Player started playing again (replay / seek-after-ended) → RESET. */
  | { type: "PLAYING" }
  /** Autoplay toggle changed mid-count (off cancels instantly). */
  | { type: "TOGGLE"; autoplay: boolean }
  /** Wall-clock tick (throttled-tab safe — deadline math, not accumulation). */
  | { type: "TICK"; now: number }
  /** User cancel (circular X button / Escape / space). */
  | { type: "CANCEL" }
  /** Immediate advance (user clicked the next-video preview). */
  | { type: "FIRE" };

export function countdownReducer(
  state: AutoplayCountdownState,
  event: CountdownEvent,
): AutoplayCountdownState {
  switch (event.type) {
    case "ENDED": {
      // Advance fires once per ENDED cycle: only an idle machine arms.
      // "cancelled" stays cancelled until a PLAYING reset (a re-ENDED
      // without a replay in between must not restart the countdown).
      if (state.status !== "idle") return state;
      if (!event.autoplay || !event.hasNext) return state;
      return {
        status: "counting",
        endsAt: event.now + COUNTDOWN_TOTAL_MS,
        totalMs: COUNTDOWN_TOTAL_MS,
      };
    }
    case "PLAYING":
      // replay / seek-after-ended → the cycle resets; a re-ENDED restarts.
      return { ...initialCountdown, totalMs: state.totalMs };
    case "TOGGLE": {
      // AUTOPLAY_OFF mid-count cancels instantly; turning it on never
      // arms anything by itself (an ENDED must re-arm).
      if (event.autoplay) return state;
      if (state.status === "counting") return { ...state, status: "cancelled", endsAt: null };
      return state;
    }
    case "TICK": {
      if (state.status !== "counting" || state.endsAt === null) return state;
      if (event.now < state.endsAt) return state;
      return { ...state, status: "fired", endsAt: null };
    }
    case "CANCEL": {
      if (state.status !== "counting") return state;
      return { ...state, status: "cancelled", endsAt: null };
    }
    case "FIRE": {
      if (state.status !== "counting") return state;
      return { ...state, status: "fired", endsAt: null };
    }
  }
}

/** Wall-clock remaining ms (0 unless counting). */
export function countdownRemaining(
  state: AutoplayCountdownState,
  now: number,
): number {
  if (state.status !== "counting" || state.endsAt === null) return 0;
  return Math.max(0, state.endsAt - now);
}

/** Whole seconds left for the "Playing next in N" label. */
export function countdownSecondsLeft(
  state: AutoplayCountdownState,
  now: number,
): number {
  return Math.ceil(countdownRemaining(state, now) / 1000);
}
