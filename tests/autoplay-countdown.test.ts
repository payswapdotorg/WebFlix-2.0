/// <reference types="bun-types" />
/**
 * WFX2-C-S tests — the watch-next autoplay countdown state machine:
 * arm-once-per-ENDED-cycle, PLAYING reset (replay/seek-after-ended),
 * wall-clock TICK firing, user CANCEL, mid-count AUTOPLAY_OFF cancel,
 * FIRE, and the never-arms edges (no next video / autoplay off).
 */
import { describe, expect, test } from "bun:test";
import {
  COUNTDOWN_SECONDS,
  COUNTDOWN_TOTAL_MS,
  countdownRemaining,
  countdownReducer,
  countdownSecondsLeft,
  initialCountdown,
} from "@/lib/watch/autoplay-countdown";

const T0 = 1_700_000_000_000; // fixed wall-clock base for deterministic math

describe("autoplay countdown — arming (ENDED)", () => {
  test("ENDED with autoplay + next → counting with a 5s wall-clock deadline", () => {
    const s = countdownReducer(initialCountdown, {
      type: "ENDED",
      autoplay: true,
      hasNext: true,
      now: T0,
    });
    expect(s.status).toBe("counting");
    expect(s.endsAt).toBe(T0 + COUNTDOWN_TOTAL_MS);
    expect(COUNTDOWN_SECONDS).toBe(5);
    expect(COUNTDOWN_TOTAL_MS).toBe(5000);
  });

  test("no next video → never arms", () => {
    const s = countdownReducer(initialCountdown, {
      type: "ENDED",
      autoplay: true,
      hasNext: false,
      now: T0,
    });
    expect(s.status).toBe("idle");
  });

  test("autoplay already off at ENDED → never arms", () => {
    const s = countdownReducer(initialCountdown, {
      type: "ENDED",
      autoplay: false,
      hasNext: true,
      now: T0,
    });
    expect(s.status).toBe("idle");
  });

  test("ENDED while counting → ignored (advance fires once per cycle)", () => {
    const armed = countdownReducer(initialCountdown, {
      type: "ENDED",
      autoplay: true,
      hasNext: true,
      now: T0,
    });
    const again = countdownReducer(armed, {
      type: "ENDED",
      autoplay: true,
      hasNext: true,
      now: T0 + 1000,
    });
    expect(again).toEqual(armed); // deadline unchanged — no re-arm
  });

  test("ENDED after CANCEL → ignored until a PLAYING reset (spurious re-ENDED cannot restart)", () => {
    const armed = countdownReducer(initialCountdown, {
      type: "ENDED",
      autoplay: true,
      hasNext: true,
      now: T0,
    });
    const cancelled = countdownReducer(armed, { type: "CANCEL" });
    const reEnded = countdownReducer(cancelled, {
      type: "ENDED",
      autoplay: true,
      hasNext: true,
      now: T0 + 500,
    });
    expect(reEnded.status).toBe("cancelled");
  });
});

describe("autoplay countdown — PLAYING reset (replay / seek-after-ended)", () => {
  test("PLAYING during counting → idle (cancel the armed countdown)", () => {
    const armed = countdownReducer(initialCountdown, {
      type: "ENDED",
      autoplay: true,
      hasNext: true,
      now: T0,
    });
    const s = countdownReducer(armed, { type: "PLAYING" });
    expect(s.status).toBe("idle");
    expect(s.endsAt).toBeNull();
  });

  test("PLAYING after fired → idle; a re-ENDED then restarts the countdown", () => {
    const armed = countdownReducer(initialCountdown, {
      type: "ENDED",
      autoplay: true,
      hasNext: true,
      now: T0,
    });
    const fired = countdownReducer(armed, { type: "TICK", now: T0 + COUNTDOWN_TOTAL_MS });
    expect(fired.status).toBe("fired");
    const reset = countdownReducer(fired, { type: "PLAYING" });
    expect(reset.status).toBe("idle");
    const reArmed = countdownReducer(reset, {
      type: "ENDED",
      autoplay: true,
      hasNext: true,
      now: T0 + 10_000,
    });
    expect(reArmed.status).toBe("counting");
    expect(reArmed.endsAt).toBe(T0 + 10_000 + COUNTDOWN_TOTAL_MS);
  });
});

describe("autoplay countdown — wall-clock TICK (throttled-tab safe)", () => {
  test("TICK before the deadline → still counting", () => {
    const armed = countdownReducer(initialCountdown, {
      type: "ENDED",
      autoplay: true,
      hasNext: true,
      now: T0,
    });
    const s = countdownReducer(armed, { type: "TICK", now: T0 + 4999 });
    expect(s.status).toBe("counting");
  });

  test("TICK at/past the deadline → fired (wall-clock math, not accumulated ticks)", () => {
    const armed = countdownReducer(initialCountdown, {
      type: "ENDED",
      autoplay: true,
      hasNext: true,
      now: T0,
    });
    // e.g. a throttled tab wakes up 3s LATE: now is past the deadline
    const s = countdownReducer(armed, { type: "TICK", now: T0 + COUNTDOWN_TOTAL_MS + 3000 });
    expect(s.status).toBe("fired");
    expect(s.endsAt).toBeNull();
  });
});

describe("autoplay countdown — cancel paths", () => {
  test("CANCEL (circular X / Esc / space) during counting → cancelled, no advance", () => {
    const armed = countdownReducer(initialCountdown, {
      type: "ENDED",
      autoplay: true,
      hasNext: true,
      now: T0,
    });
    const s = countdownReducer(armed, { type: "CANCEL" });
    expect(s.status).toBe("cancelled");
    expect(s.endsAt).toBeNull();
  });

  test("CANCEL while idle → no-op", () => {
    expect(countdownReducer(initialCountdown, { type: "CANCEL" })).toEqual(initialCountdown);
  });

  test("AUTOPLAY_OFF mid-count cancels instantly", () => {
    const armed = countdownReducer(initialCountdown, {
      type: "ENDED",
      autoplay: true,
      hasNext: true,
      now: T0,
    });
    const s = countdownReducer(armed, { type: "TOGGLE", autoplay: false });
    expect(s.status).toBe("cancelled");
  });

  test("AUTOPLAY_ON mid-count → unchanged (never arms by itself)", () => {
    const armed = countdownReducer(initialCountdown, {
      type: "ENDED",
      autoplay: true,
      hasNext: true,
      now: T0,
    });
    const s = countdownReducer(armed, { type: "TOGGLE", autoplay: true });
    expect(s).toEqual(armed);
  });
});

describe("autoplay countdown — FIRE (immediate advance)", () => {
  test("FIRE during counting → fired", () => {
    const armed = countdownReducer(initialCountdown, {
      type: "ENDED",
      autoplay: true,
      hasNext: true,
      now: T0,
    });
    expect(countdownReducer(armed, { type: "FIRE" }).status).toBe("fired");
  });
  test("FIRE while idle → no-op", () => {
    expect(countdownReducer(initialCountdown, { type: "FIRE" })).toEqual(initialCountdown);
  });
});

describe("autoplay countdown — remaining helpers", () => {
  test("countdownRemaining / secondsLeft derive from wall-clock now", () => {
    const armed = countdownReducer(initialCountdown, {
      type: "ENDED",
      autoplay: true,
      hasNext: true,
      now: T0,
    });
    expect(countdownRemaining(armed, T0)).toBe(5000);
    expect(countdownRemaining(armed, T0 + 2500)).toBe(2500);
    expect(countdownSecondsLeft(armed, T0 + 2500)).toBe(3); // ceil
    expect(countdownRemaining(armed, T0 + 9999)).toBe(0); // clamped
  });
  test("remaining is 0 unless counting", () => {
    expect(countdownRemaining(initialCountdown, T0)).toBe(0);
  });
});
