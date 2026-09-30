/// <reference types="bun-types" />
/**
 * WFX2-C-S tests — planReplaySeek: the pure replay-chat seek classifier
 * (±1s youtube.com tolerance, backward re-anchor, in-window reveal,
 * windowEnd+10s walk grace, exhausted/live no-ops) + the window/drop
 * helpers the re-anchor loop in useLiveChat composes with them.
 *
 * Fixtures mirror the replay message shape (videoOffsetTimeMsec →
 * offsetMsec on the DTO; continuation tokens as the walk handles).
 */
import { describe, expect, test } from "bun:test";
import {
  FORWARD_WALK_GRACE_SEC,
  SEEK_TOLERANCE_SEC,
  keepMessagesAtOrBelow,
  planReplaySeek,
  replayWindowFrom,
  type ReplayWindowState,
} from "@/lib/watch/replay-seek";
import type { LiveChatMessageDTO } from "@/lib/youtube/livechat";

/** Minimal replay-message fixture (offsetSec → offsetMsec). */
function rmsg(id: string, offsetSec: number | null): LiveChatMessageDTO {
  return {
    id,
    author: { id: `a-${id}`, name: `Author ${id}`, avatarUrl: null, badges: [], memberSinceText: null },
    body: `body ${id}`,
    timestampUsec: "0",
    kind: "text",
    isSuperChat: false,
    superChat: null,
    isMember: false,
    isMemberMilestone: false,
    memberMilestoneText: null,
    offsetMsec: offsetSec === null ? null : offsetSec * 1000,
  };
}

const WINDOW: ReplayWindowState = { windowEndMsec: 60_000, hasMore: true };
const EXHAUSTED: ReplayWindowState = { windowEndMsec: 60_000, hasMore: false };
const EMPTY: ReplayWindowState = { windowEndMsec: 0, hasMore: true };

describe("planReplaySeek — ±1s youtube.com tolerance", () => {
  test("exactly +1s → none (organic playback rate)", () => {
    expect(planReplaySeek(59, 60, WINDOW)).toEqual({ action: "none" });
  });
  test("exactly -1s → none", () => {
    expect(planReplaySeek(61, 60, WINDOW)).toEqual({ action: "none" });
  });
  test("sub-tolerance scrub jitter (±0.5s) → none", () => {
    expect(planReplaySeek(60, 60.5, WINDOW)).toEqual({ action: "none" });
    expect(planReplaySeek(60, 59.5, WINDOW)).toEqual({ action: "none" });
    expect(SEEK_TOLERANCE_SEC).toBe(1);
  });
});

describe("planReplaySeek — backward seeks re-anchor", () => {
  test("-2s → reanchor at the target", () => {
    expect(planReplaySeek(100, 98, WINDOW)).toEqual({ action: "reanchor", targetSec: 98 });
  });
  test("seek to 0 → reanchor at 0 (session start)", () => {
    expect(planReplaySeek(50, 0, WINDOW)).toEqual({ action: "reanchor", targetSec: 0 });
  });
  test("negative target clamps to 0", () => {
    expect(planReplaySeek(3, -1, WINDOW)).toEqual({ action: "reanchor", targetSec: 0 });
  });
  test("backward far past the window start still re-anchors (bootstrap walk)", () => {
    expect(planReplaySeek(600, 5, WINDOW)).toEqual({ action: "reanchor", targetSec: 5 });
  });
});

describe("planReplaySeek — forward seeks reveal or walk", () => {
  test("forward within the fetched window → reveal (no fetch)", () => {
    expect(planReplaySeek(30, 60, WINDOW)).toEqual({ action: "reveal" });
  });
  test("forward within windowEnd + 10s grace → reveal (reveal-gating lookahead covers it)", () => {
    expect(planReplaySeek(30, 70, WINDOW)).toEqual({ action: "reveal" });
    expect(FORWARD_WALK_GRACE_SEC).toBe(10);
  });
  test("forward exactly at the grace boundary (==) → reveal", () => {
    expect(planReplaySeek(30, 70, WINDOW)).toEqual({ action: "reveal" });
  });
  test("forward past windowEnd + 10s with continuations → walk from the current token", () => {
    expect(planReplaySeek(30, 71, WINDOW)).toEqual({ action: "walk", targetSec: 71 });
  });
  test("forward past the grace but replay exhausted (hasMore=false) → reveal (honest no-op)", () => {
    expect(planReplaySeek(30, 300, EXHAUSTED)).toEqual({ action: "reveal" });
  });
  test("forward from an empty window with continuations → walk", () => {
    expect(planReplaySeek(0, 15, EMPTY)).toEqual({ action: "walk", targetSec: 15 });
  });
  test("forward from an empty exhausted window → reveal", () => {
    expect(planReplaySeek(0, 15, { windowEndMsec: 0, hasMore: false })).toEqual({ action: "reveal" });
  });
});

describe("planReplaySeek — live chat never seeks", () => {
  test("windowState null (live) → none for both directions", () => {
    expect(planReplaySeek(100, 30, null)).toEqual({ action: "none" });
    expect(planReplaySeek(30, 300, null)).toEqual({ action: "none" });
  });
});

describe("replayWindowFrom — window derivation", () => {
  test("windowEndMsec = newest offset (nulls ignored), hasMore from the token", () => {
    const w = replayWindowFrom([rmsg("a", 0), rmsg("b", 15), rmsg("c", 7)], "tok");
    expect(w).toEqual({ windowEndMsec: 15_000, hasMore: true });
  });
  test("null nextToken → hasMore false (replay exhausted)", () => {
    const w = replayWindowFrom([rmsg("a", 12)], null);
    expect(w).toEqual({ windowEndMsec: 12_000, hasMore: false });
  });
  test("empty messages → windowEnd 0", () => {
    expect(replayWindowFrom([], "tok")).toEqual({ windowEndMsec: 0, hasMore: true });
  });
});

describe("keepMessagesAtOrBelow — backward-seek drop rule", () => {
  test("drops messages after the new playhead, keeps at/below", () => {
    const kept = keepMessagesAtOrBelow(
      [rmsg("a", 0), rmsg("b", 3), rmsg("c", 4), rmsg("d", 10)],
      4,
    );
    expect(kept.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
  test("offset-less (live-style/system) messages are kept", () => {
    const kept = keepMessagesAtOrBelow([rmsg("sys", null), rmsg("d", 10)], 4);
    expect(kept.map((m) => m.id)).toEqual(["sys"]);
  });
  test("clamps negative targets to 0 (everything future dropped)", () => {
    const kept = keepMessagesAtOrBelow([rmsg("a", 0), rmsg("b", 1)], -5);
    expect(kept.map((m) => m.id)).toEqual(["a"]);
  });
});
