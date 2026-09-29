/// <reference types="bun-types" />
/**
 * WFX2-A-S — live chat mapping + session-discovery tests.
 * FIXTURES ONLY (ground rule: no live network in tests).
 *
 * Fixtures:
 * - tests/fixtures/yt/livechat_aljazeera.json — REAL get_live_chat capture
 *   (66 liveChatTextMessageRenderer + 9 placeholder + 1 viewerEngagement +
 *   1 banner, Al Jazeera live stream).
 * - tests/fixtures/yt/livechat_paid_synth.json — HAND-WRITTEN minimal
 *   Super Chat / sticker / member-milestone / ticker / badges shapes
 *   (marked as such — the real fixture contains none).
 * - tests/fixtures/yt/next_livechat_session_synth.json +
 *   next_livechat_ended_synth.json — synthetic-shaped-from-real next()
 *   responses for session discovery.
 */
import { describe, expect, test } from "bun:test";
import {
  findChatContinuation,
  isVideoLive,
  liveViewersFromNext,
  mapChatAction,
  parseLiveChatFrame,
  actionKindName,
} from "@/lib/youtube/livechat";

const aljazeera = await Bun.file(
  "tests/fixtures/yt/livechat_aljazeera.json",
).json();
const paid = await Bun.file("tests/fixtures/yt/livechat_paid_synth.json").json();
const nextLive = await Bun.file(
  "tests/fixtures/yt/next_livechat_session_synth.json",
).json();
const nextEnded = await Bun.file(
  "tests/fixtures/yt/next_livechat_ended_synth.json",
).json();
const replayFixture = await Bun.file(
  "tests/fixtures/yt/livechat_replay_synth.json",
).json();

const aljazeeraActions =
  aljazeera.continuationContents.liveChatContinuation.actions;

describe("live chat frame parsing — REAL livechat_aljazeera fixture", () => {
  const frame = parseLiveChatFrame(aljazeera, "live");

  test("maps all 66 liveChatTextMessageRenderer messages (+1 banner)", () => {
    // 76 actions = 66 text + 1 banner(text payload) + 9 placeholder + 1 viewerEngagement(system)
    expect(frame.messages.filter((m) => m.kind === "text")).toHaveLength(66);
    expect(frame.messages.filter((m) => m.kind === "banner")).toHaveLength(1);
    expect(frame.messages.filter((m) => m.kind === "system")).toHaveLength(1);
    expect(frame.messages).toHaveLength(68);
  });

  test("counts skipped unknown/unmappable actions in the debug field", () => {
    // 9 placeholders are unmappable; deletions none here. 76 - 68 = 8…
    // (9 placeholders skipped, 0 others) — skippedActions counts unmapped:
    expect(frame.skippedActions).toBe(9);
    expect(frame.skippedKinds).toContain("addChatItemAction");
  });

  test("authors and bodies survive the mapping (spot checks)", () => {
    const texts = frame.messages.filter((m) => m.kind === "text");
    const first = texts[0];
    expect(first.author.name).toBe("@hamidwahid1171");
    expect(first.body).toBe("America is they fishing Saudi ");
    expect(first.author.id).toBe("UCXzcSCEYC2EqblkEBK3S4lw");
    expect(first.timestampUsec).toMatch(/^\d+$/);
    expect(first.author.avatarUrl).toMatch(/^https:\/\//);
    // the pinned banner is the welcome message from the channel
    const banner = frame.messages.find((m) => m.kind === "banner");
    expect(banner?.body).toContain("Welcome to the #AlJazeeraEnglish Live chatroom");
    expect(banner?.author.name).toBe("@aljazeeraenglish");
  });

  test("all message ids are unique and non-empty", () => {
    const ids = frame.messages.map((m) => m.id);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("plain chat users carry no badges and no superchat", () => {
    const plain = frame.messages.filter((m) => m.kind === "text")[0];
    expect(plain.author.badges).toHaveLength(0);
    expect(plain.author.memberSinceText).toBeNull();
    expect(plain.isSuperChat).toBe(false);
    expect(plain.superChat).toBeNull();
    expect(plain.isMember).toBe(false);
    expect(plain.offsetMsec).toBeNull();
  });

  test("pollMs comes from the response's own timeoutMs (10000)", () => {
    expect(frame.pollMs).toBe(10000);
  });

  test("continuation advance: nextToken present from invalidationContinuationData", () => {
    expect(frame.nextToken).toBeTypeOf("string");
    expect(frame.nextToken!.length).toBeGreaterThan(50);
    expect(frame.mode).toBe("live"); // the route layer adds isReplay from mode
  });

  test("participants count extracted from participantsList", () => {
    // the real capture has one participant (the channel itself)
    expect(frame.participants).toBe(1);
  });
});

describe("super chat / paid renderers — HAND-WRITTEN synthetic shapes", () => {
  const frame = parseLiveChatFrame(paid, "live");

  test("Super Chat (liveChatPaidMessageRenderer) maps with amount + tier color", () => {
    const sc = frame.messages.find((m) => m.kind === "superchat");
    expect(sc).toBeDefined();
    expect(sc!.isSuperChat).toBe(true);
    expect(sc!.author.name).toBe("@superfan");
    expect(sc!.author.badges).toContain("member");
    expect(sc!.author.memberSinceText).toBe("Member (12 months)");
    expect(sc!.body).toBe("Keep going! Great stream");
    expect(sc!.superChat!.amountText).toBe("US$5.00");
    expect(sc!.superChat!.amountMicros).toBe("5000000");
    expect(sc!.superChat!.currency).toBe("USD");
    // 4294948652 is the known tier-1 Super Chat background
    expect(sc!.superChat!.color).toBe("#0f9d58");
  });

  test("Super Sticker (liveChatPaidStickerRenderer) maps", () => {
    const st = frame.messages.find((m) => m.kind === "supersticker");
    expect(st).toBeDefined();
    expect(st!.superChat!.amountText).toBe("$2.00");
    expect(st!.body).toBe("Love Heart Sticker");
    expect(st!.superChat!.currency).toBe("USD");
  });

  test("member milestone maps with memberMilestoneText", () => {
    const ms = frame.messages.find((m) => m.kind === "member-milestone");
    expect(ms).toBeDefined();
    expect(ms!.isMember).toBe(true);
    expect(ms!.isMemberMilestone).toBe(true);
    expect(ms!.memberMilestoneText).toBe("6 months as a member");
    expect(ms!.body).toBe("6 months strong");
  });

  test("ticker action (addLiveChatTickerItemAction) maps to a superchat row", () => {
    // the ticker action and the paid action describe the same purchase
    const sups = frame.messages.filter((m) => m.kind === "superchat");
    expect(sups.length).toBe(2);
    const ticker = sups.find((m) => m.id === "ChkKCzEyMzQ1Njc4OTAxMjM3");
    expect(ticker?.superChat?.amountText).toBe("US$5.00");
    expect(ticker?.superChat?.body).toBe("Keep going! Great stream");
  });

  test("moderator + verified badges map from iconType", () => {
    const mod = frame.messages.find((m) => m.author.name === "@moduser");
    expect(mod).toBeDefined();
    expect(mod!.author.badges).toEqual(
      expect.arrayContaining(["moderator", "verified"]),
    );
  });

  test("placeholder skipped, deletion ignored-but-counted, unknown kind counted", () => {
    // 8 actions: paid, sticker, milestone, ticker(→msg), mod text(→msg),
    // placeholder(→skip), deletion(→counted unmapped), unknown(→counted)
    expect(frame.skippedActions).toBe(3);
    expect(frame.skippedKinds).toContain("addChatItemAction");
    expect(frame.skippedKinds).toContain("markChatItemAsDeletedAction");
    expect(frame.skippedKinds).toContain("totallyUnknownActionKind");
  });

  test("timedContinuationData pollMs + nextToken", () => {
    expect(frame.pollMs).toBe(7300);
    expect(frame.nextToken).toBe("synthetic-next-token-abc");
  });

  test("mapChatAction returns [] for a null action; kind name 'invalid'", () => {
    expect(mapChatAction(null)).toHaveLength(0);
    expect(mapChatAction(undefined)).toHaveLength(0);
    expect(actionKindName(null)).toBe("invalid");
    expect(actionKindName({ clickTrackingParams: "x" })).toBe("empty");
  });
});

describe("session discovery — synthetic-shaped-from-real next() responses", () => {
  test("finds the conversationBar continuation token (VERIFIED path)", () => {
    const found = findChatContinuation(nextLive);
    expect(found).not.toBeNull();
    expect(found!.continuation).toMatch(/^0ofMyAOE/);
  });

  test("isVideoLive detects the live signal (isLive + watching now)", () => {
    expect(isVideoLive(nextLive)).toBe(true);
    expect(isVideoLive(nextEnded)).toBe(false);
  });

  test("liveViewersFromNext parses originalViewCount", () => {
    expect(liveViewersFromNext(nextLive)).toBe(6027);
    expect(liveViewersFromNext(nextEnded)).toBeNull();
  });

  test("ended-live conversationBar still yields a (replay-family) token", () => {
    const found = findChatContinuation(nextEnded);
    expect(found).not.toBeNull();
    expect(found!.continuation).toMatch(/^op2w0w/); // replay token family
  });

  test("no conversationBar → null (no chat)", () => {
    expect(findChatContinuation({ contents: {} })).toBeNull();
    expect(findChatContinuation(null)).toBeNull();
  });
});

describe("replay mode — synthetic-shaped-from-real get_live_chat_replay capture", () => {
  const replay = replayFixture;

  test("replayChatItemAction wrappers map with videoOffsetTimeMsec", () => {
    const frame = parseLiveChatFrame(replay, "replay");
    expect(frame.mode).toBe("replay");
    // 8 actions: viewerEngagement(system) + modeChange(system) + 6 text
    expect(frame.messages).toHaveLength(8);
    const offsets = frame.messages.map((m) => m.offsetMsec);
    expect(offsets).toEqual([0, 1997, 8228, 11404, 11598, 11873, 12316, 12339]);
    expect(frame.messages.every((m) => m.offsetMsec !== null)).toBe(true);
  });

  test("replay continuation: liveChatReplayContinuationData advances (not playerSeek)", () => {
    const frame = parseLiveChatFrame(replay, "replay");
    expect(frame.nextToken).toBeTypeOf("string");
    expect(frame.nextToken).toMatch(/^op2w0w/);
    // pollMs default 0 in replay (no timed polling)
    expect(frame.pollMs).toBe(0);
  });
});
