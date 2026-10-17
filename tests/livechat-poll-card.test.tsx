/// <reference types="bun-types" />
/**
 * REA-2 (G20) tests — the live POLL card in the panel (display-only) + the
 * hook's replace-on-collision refresh semantics.
 *
 * happy-dom + createRoot/act (the livechat-send harness) with a stubbed
 * fetch (the panel's /livechat polling) + a mocked session hook. The poll
 * DTOs mirror the REAL capture (tests/fixtures/yt/livechat_poll_frame.json
 * — the sanitized esports-stream capture): "IG VS SRG", "@HilmanAufa • 3h
 * ago • 606 votes", SRG 79% / IG 21%.
 *
 * The honest-degradation pins:
 * - the card renders exactly what the payload carried: bare rows pre-tally,
 *   bars + percents only when the state update delivered them;
 * - NO vote affordance anywhere in the card (display-only — the vote write
 *   is youtube.com's; the disclosure line says so);
 * - a poll row without a payload renders nothing.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test, mock } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { LiveChatMessageDTO, LiveChatPollDTO } from "@/lib/youtube/livechat";

// ---- happy-dom as the global DOM (the livechat-send harness) ----------
const win = new Window();
const domProps = [
  "window",
  "document",
  "HTMLElement",
  "HTMLTextAreaElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "Element",
  "Node",
  "NodeFilter",
  "NodeListOf",
  "Event",
  "FocusEvent",
  "InputEvent",
  "KeyboardEvent",
  "MouseEvent",
  "CustomEvent",
  "MutationObserver",
  "IntersectionObserver",
  "ResizeObserver",
  "DOMParser",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "navigator",
] as const;
for (const p of domProps) {
  Object.defineProperty(globalThis, p, {
    value: (win as unknown as Record<string, unknown>)[p],
    configurable: true,
    writable: true,
  });
}
Object.defineProperty(globalThis, "localStorage", {
  value: win.localStorage,
  configurable: true,
  writable: true,
});
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const VIDEO = "REPLAY9";
const BASE = `/api/videos/${VIDEO}/livechat`;

// ---- fixtures ------------------------------------------------------------
const POLL_ID = "ChwKGkNOWGJ1NTJFd1pjREZZNUNUQWdkeG9nUjBn";

function pollPayload(over: Partial<LiveChatPollDTO> = {}): LiveChatPollDTO {
  return {
    pollId: POLL_ID,
    question: "IG VS SRG",
    metaText: "@HilmanAufa • 3h ago • 606 votes",
    authorText: "@HilmanAufa",
    avatarUrl: null,
    votesText: "606 votes",
    pollType: "creator",
    choices: [
      { text: "SRG ", ratio: null, percentText: null, selected: null },
      { text: "IG", ratio: null, percentText: null, selected: null },
    ],
    ...over,
  };
}

function tallyPayload(): LiveChatPollDTO {
  return pollPayload({
    choices: [
      { text: "SRG ", ratio: 0.7904, percentText: "79%", selected: false },
      { text: "IG", ratio: 0.2096, percentText: "21%", selected: false },
    ],
  });
}

function rmsg(id: string, offsetSec: number): LiveChatMessageDTO {
  return {
    id,
    author: { id: `a-${id}`, name: `Author ${id}`, avatarUrl: null, badges: [], memberSinceText: null },
    body: `body ${id}`,
    timestampUsec: "0",
    kind: "text",
    isSuperChat: false,
    superChat: null,
    poll: null,
    isMember: false,
    isMemberMilestone: false,
    memberMilestoneText: null,
    offsetMsec: offsetSec * 1000,
  };
}

function pmsg(poll: LiveChatPollDTO | null, offsetSec: number): LiveChatMessageDTO {
  return {
    id: poll?.pollId ?? POLL_ID,
    author: { id: "", name: poll?.authorText ?? "Live poll", avatarUrl: poll?.avatarUrl ?? null, badges: [], memberSinceText: null },
    body: poll?.question ?? "",
    timestampUsec: "",
    kind: "poll",
    isSuperChat: false,
    superChat: null,
    poll,
    isMember: false,
    isMemberMilestone: false,
    memberMilestoneText: null,
    offsetMsec: offsetSec * 1000,
  };
}

// ---- the fetch stub: the panel's livechat polling (stateful router) -----
type Frame = Record<string, unknown>;
let router: (call: number) => Frame = () => {
  throw new Error("router unset");
};
let calls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request) => {
  const u = String(url instanceof Request ? url.url : url);
  if (!u.startsWith(BASE)) throw new Error(`unexpected fetch ${u}`);
  calls += 1;
  const body = router(calls);
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as unknown as typeof fetch;

function replayFrame(messages: LiveChatMessageDTO[], nextToken: string | null): Frame {
  return {
    chatAvailable: true,
    mode: "replay",
    isReplay: true,
    pollMs: 0,
    participants: null,
    nextToken,
    messages,
  };
}

// ---- the session mock ----------------------------------------------------
mock.module("@/hooks/use-webflix-session", () => ({
  useWebFlixSession: () => ({ status: "authenticated", user: null }),
}));

const { LiveChatPanel } = await import("@/components/watch/live-chat-panel");

// ---- harness -------------------------------------------------------------
let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function renderPanelAt(sec: number) {
  if (!host) {
    host = win.document.createElement("div");
    win.document.body.appendChild(host);
    root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  }
  await act(async () => {
    root!.render(<LiveChatPanel videoId={VIDEO} currentTimeSec={sec} />);
  });
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await sleep(10);
    });
  }
}

const pollCards = () => (host ? Array.from(host.querySelectorAll('[data-testid="live-chat-poll"]')) : []);
const pollCard = () => pollCards()[0] ?? null;
const choices = () => (host ? Array.from(host.querySelectorAll('[data-testid="poll-choice"]')) : []);
const bars = () => (host ? Array.from(host.querySelectorAll('[data-testid="poll-choice-bar"]')) : []);

beforeEach(() => {
  calls = 0;
  router = () => {
    throw new Error("router unset");
  };
});

afterEach(() => {
  if (root) {
    act(() => {
      root!.unmount();
    });
  }
  root = null;
  host = null;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("REA-2 G20 — the poll card renders from the measured payload", () => {
  test("the tallied card: question, meta line, percents, bars, disclosure", async () => {
    router = () => replayFrame([rmsg("r1", 100), pmsg(tallyPayload(), 110)], null);
    await renderPanelAt(150);
    const card = pollCard();
    expect(card).not.toBeNull();
    expect(card!.getAttribute("data-poll-type")).toBe("creator");
    expect(card!.textContent).toContain("IG VS SRG");
    expect(card!.textContent).toContain("@HilmanAufa • 3h ago • 606 votes");
    const cs = choices();
    expect(cs.length).toBe(2);
    expect(cs[0].getAttribute("data-percent")).toBe("79%");
    expect(cs[1].getAttribute("data-percent")).toBe("21%");
    expect(cs[0].textContent).toContain("SRG ");
    // the bars: 79% / 21% of the row width, behind the text
    const bs = bars();
    expect(bs.length).toBe(2);
    expect(bs[0].getAttribute("style")).toContain("width: 79%");
    expect(bs[1].getAttribute("style")).toContain("width: 21%");
    // the honest disclosure
    expect(card!.textContent).toContain("Poll voting is youtube.com");
  });

  test("NO vote affordance — the choices are state rows, never buttons", async () => {
    router = () => replayFrame([pmsg(tallyPayload(), 110)], null);
    await renderPanelAt(150);
    const card = pollCard();
    expect(card).not.toBeNull();
    expect(card!.querySelectorAll("button").length).toBe(0);
    expect(bars().length).toBe(2); // the only interactive-looking element is the bar (aria-hidden)
  });

  test("the pre-tally card: bare rows — no bar, no percent (nothing invented)", async () => {
    router = () => replayFrame([rmsg("r1", 100), pmsg(pollPayload(), 110)], null);
    await renderPanelAt(150);
    const card = pollCard();
    expect(card).not.toBeNull();
    expect(choices().length).toBe(2);
    expect(bars().length).toBe(0);
    for (const c of choices()) {
      expect(c.getAttribute("data-percent")).toBeNull();
    }
    expect(card!.textContent).toContain("SRG ");
    expect(card!.textContent).toContain("IG");
  });

  test("the payload's own selected flag renders the your-vote mark (pass-through)", async () => {
    const sel = pollPayload({
      choices: [
        { text: "SRG ", ratio: 0.7904, percentText: "79%", selected: true },
        { text: "IG", ratio: 0.2096, percentText: "21%", selected: false },
      ],
    });
    router = () => replayFrame([pmsg(sel, 110)], null);
    await renderPanelAt(150);
    const card = pollCard();
    expect(card).not.toBeNull();
    expect(card!.querySelector('[aria-label="Your vote"]')).not.toBeNull();
    expect(choices()[0].className).toContain("border-primary");
  });

  test("a poll row WITHOUT a payload renders nothing (the null guard)", async () => {
    router = () => replayFrame([rmsg("r1", 100), pmsg(null, 110)], null);
    await renderPanelAt(150);
    expect(pollCards().length).toBe(0);
    // the text row still renders — the broken poll never breaks the stream
    expect(host!.textContent).toContain("body r1");
  });
});

describe("REA-2 G20 — the replace-on-collision refresh (the measured update stream)", () => {
  test("a later same-id update refreshes the SAME card in place — no duplicate", async () => {
    router = (call) =>
      call === 1
        ? replayFrame([rmsg("r1", 100), pmsg(pollPayload(), 110)], "replay-tok-2")
        : replayFrame([pmsg(tallyPayload(), 125), rmsg("r2", 130)], null);
    await renderPanelAt(105); // bootstrap: frame1 lands; the poll sits past the playhead
    expect(pollCards().length).toBe(0); // reveal gating — not yet at 110
    expect(host!.textContent).toContain("body r1");

    await renderPanelAt(111); // the playhead passes the newest offset → frame2
    await act(async () => {
      await sleep(30);
    });
    const cards = pollCards();
    expect(cards.length).toBe(1); // ONE card — never a second row for the same pollId
    expect(cards[0].textContent).toContain("79%"); // refreshed with the tallies
    expect(bars().length).toBe(2);
    // the stream position is kept: r1 (frame1) ahead of the card, r2 (frame2) after it
    const rows = Array.from(host!.querySelectorAll('[data-testid="poll-choice"]'));
    expect(rows.length).toBe(2);
    expect(host!.textContent).toContain("body r1");
  });

  test("within-frame: panel form + state update in ONE frame — the later state wins", async () => {
    router = () =>
      replayFrame(
        [rmsg("r1", 100), pmsg(pollPayload(), 108), pmsg(tallyPayload(), 112)],
        null,
      );
    await renderPanelAt(150);
    const cards = pollCards();
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain("79%");
    expect(bars().length).toBe(2);
  });

  test("a true duplicate non-poll row still drops (the pre-G20 semantics hold)", async () => {
    router = (call) =>
      call === 1
        ? replayFrame([rmsg("r1", 100), pmsg(pollPayload(), 110)], "t2")
        : replayFrame([rmsg("r1", 100), pmsg(tallyPayload(), 125)], null);
    await renderPanelAt(105);
    await renderPanelAt(120);
    await act(async () => {
      await sleep(30);
    });
    expect(host!.textContent).toContain("body r1");
    expect(host!.textContent.match(/body r1/g)?.length).toBe(1); // the duplicate dropped
    expect(pollCards().length).toBe(1);
  });
});
