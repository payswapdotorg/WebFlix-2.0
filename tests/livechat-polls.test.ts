/// <reference types="bun-types" />
/**
 * REA-2 (G20) tests — the live-chat POLL family (display-only), mapper side.
 *
 * Fixtures-only, no live calls, no /player endpoint:
 * - tests/fixtures/yt/livechat_poll_frame.json — SANITIZED REAL capture
 *   (live esports stream, 2026-10-17): the panel form
 *   (showLiveChatActionPanelAction — no tallies, signinEndpoint per choice)
 *   + two updateLiveChatPollAction state updates (voteRatio/votePercentage),
 *   verbatim from the probe capture.
 * - tests/fixtures/yt/livechat_poll_replay.json — the same REAL update +
 *   panel actions wrapped in the REAL replayChatItemAction shape
 *   (videoOffsetTimeMsec + actions[]), the documented replay delivery.
 *
 * The honest-absence pins:
 * - No prediction mapper exists — an unknown action (any unmeasured shape)
 *   lands in the skipped counter, never a fabricated row.
 * - A poll without a payload renders nothing (mapPollRenderer → null).
 * - The meta line, choices, and percent texts are BYTE-EXACT pass-throughs
 *   of the capture ("@HilmanAufa • 3h ago • 606 votes", "79%", "21%").
 */
import { describe, expect, test } from "bun:test";
import {
  mapChatAction,
  mapPollRenderer,
  parseLiveChatFrame,
} from "@/lib/youtube/livechat";

const liveFrame = await Bun.file("tests/fixtures/yt/livechat_poll_frame.json").json();
const replayFrame = await Bun.file("tests/fixtures/yt/livechat_poll_replay.json").json();

const POLL_ID = "ChwKGkNOWGJ1NTJFd1pjREZZNUNUQWdkeG9nUjBn";
const AVATAR =
  "https://yt4.ggpht.com/ytc/AIdro_m_dwCZ4ukN9Jmlx2SyH1QfCrOXpli0ESFuzHbDmd3rgMw=s64-c-k-c0x00ffffff-no-rj";

describe("REA-2 G20 — the poll family on the REAL live capture", () => {
  const frame = parseLiveChatFrame(liveFrame, "live");

  test("the frame maps to 3 poll rows (panel form + 2 state updates)", () => {
    expect(frame.messages.length).toBe(3);
    for (const m of frame.messages) {
      expect(m.kind).toBe("poll");
      expect(m.id).toBe(POLL_ID);
      expect(m.poll).not.toBeNull();
    }
    expect(frame.skippedActions).toBe(0);
    expect(frame.pollMs).toBe(10000);
    expect(frame.nextToken).toBe("REA2-LIVE-TOKEN-PLACEHOLDER");
    expect(frame.mode).toBe("live");
  });

  test("the panel form maps with NO tallies (the honest pre-tally state)", () => {
    const panel = frame.messages[0];
    expect(panel.poll!.question).toBe("IG VS SRG");
    expect(panel.poll!.metaText).toBe("@HilmanAufa • 3h ago • 606 votes");
    expect(panel.poll!.authorText).toBe("@HilmanAufa");
    expect(panel.poll!.votesText).toBe("606 votes");
    expect(panel.poll!.pollType).toBe("creator");
    expect(panel.poll!.avatarUrl).toBe(AVATAR);
    expect(panel.poll!.choices.map((c) => c.text)).toEqual(["SRG ", "IG"]);
    for (const c of panel.poll!.choices) {
      expect(c.ratio).toBeNull(); // no tally in the panel form — never invented
      expect(c.percentText).toBeNull();
      expect(c.selected).toBe(false); // the payload's own flag, pass-through
    }
  });

  test("the state updates map the tallies byte-exact (79% / 21%)", () => {
    const upd = frame.messages[1];
    const [srg, ig] = upd.poll!.choices;
    expect(srg.ratio).toBeCloseTo(0.7904, 4);
    expect(srg.percentText).toBe("79%");
    expect(ig.ratio).toBeCloseTo(0.2096, 4);
    expect(ig.percentText).toBe("21%");
    expect(upd.poll!.votesText).toBe("606 votes");
    expect(upd.body).toBe("IG VS SRG"); // the card's screen-reader text
    expect(upd.timestampUsec).toBe(""); // no timestamp is synthesized — the
    // meta line's "3h ago" is display text
  });

  test("consecutive updates stay same-id (the refresh key for the panel)", () => {
    const second = frame.messages[2];
    expect(second.id).toBe(POLL_ID);
    expect(second.poll!.choices[0].percentText).toBe("79%");
  });
});

describe("REA-2 G20 — the poll family on the replay capture", () => {
  test("replayChatItemAction-wrapped polls carry the video offsets", () => {
    const frame = parseLiveChatFrame(replayFrame, "replay");
    expect(frame.messages.length).toBe(2);
    expect(frame.mode).toBe("replay");
    const [upd, panel] = frame.messages;
    expect(upd.offsetMsec).toBe(3187000);
    expect(upd.kind).toBe("poll");
    expect(upd.poll!.choices[0].percentText).toBe("79%"); // the update keeps tallies through the wrapper
    expect(panel.offsetMsec).toBe(3188000);
    expect(panel.poll!.choices[0].ratio).toBeNull(); // the panel form still has no tallies
  });
});

describe("REA-2 G20 — honest degradation (never a fabricated poll)", () => {
  test("mapPollRenderer: empty object → null", () => {
    expect(mapPollRenderer({})).toBeNull();
  });

  test("mapPollRenderer: missing liveChatPollId → null", () => {
    const r = JSON.parse(
      JSON.stringify(liveFrame.continuationContents.liveChatContinuation.actions[1]),
    ).updateLiveChatPollAction.pollToUpdate.pollRenderer as Record<string, unknown>;
    delete r.liveChatPollId;
    expect(mapPollRenderer(r)).toBeNull();
  });

  test("mapPollRenderer: empty question → null", () => {
    const r = JSON.parse(
      JSON.stringify(liveFrame.continuationContents.liveChatContinuation.actions[1]),
    ).updateLiveChatPollAction.pollToUpdate.pollRenderer as Record<string, unknown>;
    (r.header as Record<string, unknown>).pollHeaderRenderer = { pollQuestion: { runs: [] } };
    expect(mapPollRenderer(r)).toBeNull();
  });

  test("mapPollRenderer: all choices unlabeled → null (an unlabeled poll cannot display honestly)", () => {
    const r = JSON.parse(
      JSON.stringify(liveFrame.continuationContents.liveChatContinuation.actions[1]),
    ).updateLiveChatPollAction.pollToUpdate.pollRenderer as Record<string, unknown>;
    r.choices = [{ text: { runs: [] } }, { no_text: true }];
    expect(mapPollRenderer(r)).toBeNull();
  });

  test("mapPollRenderer: a ratio without votePercentage keeps the ratio, drops the percent", () => {
    const r: Record<string, unknown> = JSON.parse(
      JSON.stringify(liveFrame.continuationContents.liveChatContinuation.actions[1]),
    ).updateLiveChatPollAction.pollToUpdate.pollRenderer;
    for (const c of r.choices as Array<Record<string, unknown>>) {
      delete c.votePercentage;
    }
    const out = mapPollRenderer(r);
    expect(out).not.toBeNull();
    expect(out!.choices[0].ratio).toBeCloseTo(0.7904, 4);
    expect(out!.choices[0].percentText).toBeNull();
  });

  test("an UNKNOWN action (the honest-absence family — e.g. a prediction) is skipped + counted, never mapped", () => {
    const frame = parseLiveChatFrame(
      {
        continuationContents: {
          liveChatContinuation: {
            actions: [
              { someUnmeasuredAction: { anything: true } }, // never invented into a row
              liveFrame.continuationContents.liveChatContinuation.actions[1],
            ],
            continuations: [],
          },
        },
      },
      "live",
    );
    expect(frame.messages.length).toBe(1); // only the poll row
    expect(frame.messages[0].kind).toBe("poll");
    expect(frame.skippedActions).toBe(1);
    expect(frame.skippedKinds).toContain("someUnmeasuredAction");
  });

  test("mapChatAction: null action → [] (the pre-existing contract holds)", () => {
    expect(mapChatAction(null)).toEqual([]);
    expect(mapChatAction(undefined)).toEqual([]);
  });
});
