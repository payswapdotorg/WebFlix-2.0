/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Phase 3 — Worker 3-d (UI lane) tests: the three
 * presentational LIVE panels (stage grid, match panel, gift panel).
 *
 * happy-dom + createRoot/act (the auth-ui harness pattern). The panels are
 * PROPS-DRIVEN (they never subscribe to the stream, fetch, or touch the
 * db), so no module mocks are needed — fixtures are inline typed DTOs with
 * every field filled honestly.
 *
 * Pins (the 3-d row of the lane table):
 * - stage grid: host/guest tiles with role badges, honest state tags, the
 *   guests-disabled note, the solo hint, the dto-driven slot count, null →
 *   nothing;
 * - match panel: server scores verbatim + the dto-anchored countdown
 *   (ticks only after mount), "Ending…" wall-clock guard, ended
 *   wins/Draw banners, cancelled banner with muted banked scores, null →
 *   nothing — and never a locally invented score;
 * - gift panel: the FROZEN "Dev credits — no cash value" label, the
 *   catalogue selection, quantity 1..10, the team picker only when sides
 *   exist, per-click idempotency keys, honest disabled reason / error /
 *   sending states, the empty-catalogue dead end, and the verbatim feed.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type {
  GiftCatalogItemDto,
  GiftEventDto,
  LiveMatchDto,
  LiveStageDto,
  SendGiftInput,
} from "@/lib/live/types";

// ---- happy-dom as the global DOM (the auth-ui harness) ------------------
const win = new Window();
const domProps = [
  "window",
  "document",
  "HTMLElement",
  "HTMLTextAreaElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLSelectElement",
  "HTMLAnchorElement",
  "HTMLFormElement",
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

// ---- the three panels (imported after the DOM exists, the harness law) --
const { LiveStageGrid } = await import("@/components/live/live-stage-grid");
const { LiveMatchPanel } = await import("@/components/live/live-match-panel");
const { LiveGiftPanel } = await import("@/components/live/live-gift-panel");

// ---- harness -------------------------------------------------------------
let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): Element | null =>
  host ? (host.querySelector(sel) as unknown as Element | null) : null;
const all = (sel: string): Element[] =>
  host ? (Array.from(host.querySelectorAll(sel)) as unknown as Element[]) : [];

async function render(el: React.ReactElement) {
  // a test may re-render (state transitions) — retire the previous tree first
  if (root) {
    act(() => {
      root!.unmount();
    });
    root = null;
  }
  host?.remove();
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(el);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** React-safe select change: set through the prototype descriptor, then bubble. */
async function selectValue(select: HTMLSelectElement, value: string) {
  await act(async () => {
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    desc?.set?.call(select, value);
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

// ═══════════════════════════════════════════════════════════════════
// Fixtures — typed, every field filled honestly.
// ═══════════════════════════════════════════════════════════════════

const T0 = "2026-11-04T12:00:00.000Z";

function stageFixture(over: Partial<LiveStageDto> = {}): LiveStageDto {
  return {
    sessionId: "sess-3d",
    guestsEnabled: true,
    guestsMax: 4,
    participants: [
      {
        userId: "host-1",
        handle: "hostly",
        name: "Hostly Host",
        role: "host",
        state: "connected",
        joinedAt: T0,
      },
      {
        userId: "guest-1",
        handle: "guesty",
        name: "Guesty Guest",
        role: "guest",
        state: "connected",
        joinedAt: T0,
      },
    ],
    ...over,
  };
}

function matchFixture(over: Partial<LiveMatchDto> = {}): LiveMatchDto {
  return {
    id: "match-3d",
    roomId: "room-3d",
    sessionId: "sess-3d",
    kind: "solo",
    status: "active",
    durationSeconds: 125,
    scoring: { reactions: true, gifts: true },
    startedAt: "2026-11-04T11:59:55.000Z",
    endsAt: "2026-11-04T12:02:00.000Z",
    endedAt: null,
    endReason: null,
    winnerTeamId: null,
    teams: [
      {
        id: "team-a",
        label: "Team A",
        position: 1,
        score: 12,
        members: [
          { userId: "host-1", handle: "hostly", name: "Hostly Host", leftAt: null },
        ],
      },
      {
        id: "team-b",
        label: "Team B",
        position: 2,
        score: 7,
        members: [
          { userId: "guest-1", handle: "guesty", name: "Guesty Guest", leftAt: null },
        ],
      },
    ],
    // endsAt − serverNow = 125s → the first render shows a static "2:05".
    serverNow: "2026-11-04T11:59:55.000Z",
    ...over,
  };
}

const CATALOGUE: GiftCatalogItemDto[] = [
  { id: "g-comet", name: "Comet Pop", animationKind: "burst", priceCredits: 5 },
  { id: "g-lantern", name: "Sky Lantern", animationKind: "float", priceCredits: 12 },
  { id: "g-glitter", name: "Glitter Dust", animationKind: "sparkle", priceCredits: 3 },
];

function giftEventFixture(over: Partial<GiftEventDto> = {}): GiftEventDto {
  return {
    id: "gift-1",
    intentId: "intent-1",
    roomId: "room-3d",
    sessionId: "sess-3d",
    senderId: "sender-1",
    senderHandle: "alice",
    senderName: "Alice",
    recipientId: "host-1",
    giftItemId: "g-lantern",
    giftName: "Sky Lantern",
    animationKind: "float",
    quantity: 2,
    totalCredits: 24,
    matchId: null,
    matchTeamId: null,
    createdAt: "2026-11-04T12:00:10.000Z",
    ...over,
  };
}

function countdownSeconds(): number {
  const text = q('[data-testid="match-countdown"]')?.textContent ?? "";
  const m = text.match(/(\d+):(\d{2})/);
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

// ═══════════════════════════════════════════════════════════════════
// The stage grid
// ═══════════════════════════════════════════════════════════════════

describe("3-d LiveStageGrid — the host+guest stage roster", () => {
  test("host tile first + guest tile, role badges, names, handles, slot count", async () => {
    await render(<LiveStageGrid stage={stageFixture()} />);
    expect(q('[data-testid="stage-slots"]')!.textContent).toContain("1 / 4 guest slots");
    const tiles = all('[data-testid="stage-tile"]');
    expect(tiles.length).toBe(2);
    expect(tiles[0]!.getAttribute("data-role")).toBe("host");
    expect(tiles[0]!.textContent).toContain("Hostly Host");
    expect(tiles[0]!.textContent).toContain("@hostly");
    expect(tiles[0]!.querySelector('[data-testid="stage-role"]')!.textContent).toContain("Host");
    expect(tiles[1]!.getAttribute("data-role")).toBe("guest");
    expect(tiles[1]!.textContent).toContain("Guesty Guest");
    expect(tiles[1]!.querySelector('[data-testid="stage-role"]')!.textContent).toContain("Guest");
    // connected participants carry NO state tag
    expect(all('[data-testid="stage-state-tag"]').length).toBe(0);
  });

  test("honest state tags: disconnected → reconnecting…, removed → removed by host; removed guests free their slot", async () => {
    await render(
      <LiveStageGrid
        stage={stageFixture({
          participants: [
            {
              userId: "host-1",
              handle: "hostly",
              name: "Hostly Host",
              role: "host",
              state: "connected",
              joinedAt: T0,
            },
            {
              userId: "guest-1",
              handle: "guesty",
              name: "Guesty Guest",
              role: "guest",
              state: "disconnected",
              joinedAt: T0,
            },
            {
              userId: "guest-2",
              handle: "gone",
              name: "Gone Guest",
              role: "guest",
              state: "removed",
              joinedAt: T0,
            },
          ],
        })}
      />,
    );
    const tags = all('[data-testid="stage-state-tag"]');
    expect(tags.length).toBe(2);
    expect(tags[0]!.textContent).toContain("reconnecting…");
    expect(tags[1]!.textContent).toContain("removed by host");
    // the slot law: only NON-removed guests occupy slots → 1 / 4
    expect(q('[data-testid="stage-slots"]')!.textContent).toContain("1 / 4 guest slots");
  });

  test("guestsEnabled false renders the honest host-disabled note", async () => {
    await render(<LiveStageGrid stage={stageFixture({ guestsEnabled: false })} />);
    expect(q('[data-testid="stage-guests-disabled"]')!.textContent).toContain(
      "Guests are disabled by the host",
    );
  });

  test("host-only stage: the subtle Solo broadcast hint, zero slots occupied", async () => {
    await render(
      <LiveStageGrid
        stage={stageFixture({
          participants: [
            {
              userId: "host-1",
              handle: "hostly",
              name: "Hostly Host",
              role: "host",
              state: "connected",
              joinedAt: T0,
            },
          ],
        })}
      />,
    );
    expect(q('[data-testid="stage-solo"]')!.textContent).toContain("Solo broadcast");
    expect(q('[data-testid="stage-slots"]')!.textContent).toContain("0 / 4 guest slots");
  });

  test("null stage renders nothing — no fake stage is invented", async () => {
    await render(<LiveStageGrid stage={null} />);
    expect(host!.childElementCount).toBe(0);
    expect(host!.textContent).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════
// The match panel
// ═══════════════════════════════════════════════════════════════════

describe("3-d LiveMatchPanel — server-authoritative scores, dto-anchored countdown", () => {
  test("active solo match: header, LIVE badge, both server scores, countdown 2:05, policy line", async () => {
    await render(<LiveMatchPanel match={matchFixture()} />);
    expect(host!.textContent).toContain("Solo match");
    expect(q('[data-testid="match-live-badge"]')).not.toBeNull();
    const teams = all('[data-testid="match-team"]');
    expect(teams.length).toBe(2);
    expect(all('[data-testid="team-score"]')[0]!.textContent).toBe("12");
    expect(all('[data-testid="team-score"]')[1]!.textContent).toBe("7");
    expect(q('[data-testid="match-countdown"]')!.textContent).toContain("Ends in 2:05");
    expect(q('[data-testid="match-policy"]')!.textContent).toContain("Taps count");
    expect(q('[data-testid="match-policy"]')!.textContent).toContain("Gifts count");
  });

  test("the countdown ticks locally AFTER mount (dto-anchored, decreasing)", async () => {
    await render(<LiveMatchPanel match={matchFixture()} />);
    const before = countdownSeconds();
    expect(before).toBe(125);
    await act(async () => {
      await sleep(1100);
    });
    const after = countdownSeconds();
    expect(after).toBeGreaterThan(-1);
    expect(after).toBeLessThan(before); // strictly less — at least one tick
  });

  test("wall clock past endsAt → 'Ending…', never a negative number", async () => {
    await render(
      <LiveMatchPanel
        match={matchFixture({ serverNow: "2026-11-04T12:02:05.000Z" })}
      />,
    );
    const text = q('[data-testid="match-countdown"]')!.textContent ?? "";
    expect(text).toContain("Ending…");
    expect(text).not.toContain("-");
  });

  test("ended match: 'Team A wins' banner (server winnerTeamId), no LIVE badge, finals stay visible", async () => {
    await render(
      <LiveMatchPanel
        match={matchFixture({
          kind: "team",
          status: "ended",
          endedAt: "2026-11-04T12:02:00.000Z",
          endReason: "timeout",
          winnerTeamId: "team-a",
        })}
      />,
    );
    expect(host!.textContent).toContain("Team match");
    expect(q('[data-testid="match-live-badge"]')).toBeNull();
    expect(q('[data-testid="match-result"]')!.textContent).toContain("Team A wins");
    // the final scores remain visible, untouched
    expect(all('[data-testid="team-score"]')[0]!.textContent).toBe("12");
    expect(all('[data-testid="team-score"]')[1]!.textContent).toBe("7");
    expect(q('[data-testid="match-countdown"]')).toBeNull(); // terminal → no ticking
  });

  test("ended with winnerTeamId null → 'Draw'", async () => {
    await render(
      <LiveMatchPanel
        match={matchFixture({
          status: "ended",
          endedAt: "2026-11-04T12:02:00.000Z",
          endReason: "timeout",
          winnerTeamId: null,
        })}
      />,
    );
    expect(q('[data-testid="match-result"]')!.textContent).toContain("Draw");
  });

  test("cancelled: 'Match cancelled' banner, banked scores visible but muted, no winner", async () => {
    await render(
      <LiveMatchPanel
        match={matchFixture({
          status: "cancelled",
          endedAt: "2026-11-04T12:01:00.000Z",
          endReason: null,
          winnerTeamId: null,
          scoring: { reactions: false, gifts: false },
        })}
      />,
    );
    expect(q('[data-testid="match-cancelled"]')!.textContent).toContain("Match cancelled");
    expect(q('[data-testid="match-result"]')).toBeNull();
    expect(q('[data-testid="match-live-badge"]')).toBeNull();
    // banked scores stand (visible), muted styling (opacity), honest policy
    expect(all('[data-testid="team-score"]')[0]!.textContent).toBe("12");
    expect(all('[data-testid="match-team"]')[0]!.className).toContain("opacity-60");
    expect(q('[data-testid="match-policy"]')!.textContent).toContain("No scoring inputs");
  });

  test("null match renders nothing", async () => {
    await render(<LiveMatchPanel match={null} />);
    expect(host!.childElementCount).toBe(0);
    expect(host!.textContent).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════
// The gift panel
// ═══════════════════════════════════════════════════════════════════

describe("3-d LiveGiftPanel — the non-monetary dev-credit sandbox surface", () => {
  const noopSend = () => {};

  test("the frozen sandbox label 'Dev credits — no cash value' is present, catalogue renders prices + animation hints", async () => {
    await render(<LiveGiftPanel catalogue={CATALOGUE} gifts={[]} canSend onSend={noopSend} />);
    expect(q('[data-testid="gift-sandbox-label"]')!.textContent).toContain(
      "Dev credits — no cash value",
    );
    const items = all('[data-testid="gift-item"]');
    expect(items.length).toBe(3);
    expect(items[0]!.textContent).toContain("Comet Pop");
    expect(items[0]!.textContent).toContain("5 dev credits");
    expect(items[0]!.textContent).toContain("burst");
    expect(items[1]!.textContent).toContain("12 dev credits");
    expect(items[1]!.textContent).toContain("float");
    // the first catalogue item is selected by default (ring state = aria-pressed)
    expect(items[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(items[1]!.getAttribute("aria-pressed")).toBe("false");
  });

  test("canSend=false: the send button is disabled and the honest reason is rendered", async () => {
    await render(
      <LiveGiftPanel
        catalogue={CATALOGUE}
        gifts={[]}
        canSend={false}
        disabledReason="Sign in to send gifts"
        onSend={noopSend}
      />,
    );
    const send = q('[data-testid="gift-send"]') as unknown as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(q('[data-testid="gift-disabled-reason"]')!.textContent).toContain(
      "Sign in to send gifts",
    );
  });

  test("sending=true: spinner state and a disabled button", async () => {
    await render(
      <LiveGiftPanel catalogue={CATALOGUE} gifts={[]} canSend sending onSend={noopSend} />,
    );
    const send = q('[data-testid="gift-send"]') as unknown as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(send.textContent).toContain("Sending…");
    expect(send.querySelector(".animate-spin")).not.toBeNull();
  });

  test("a send click calls onSend with { giftItemId, quantity, clientRequestId ≥8 chars } and NO matchTeamId; a second click gets a FRESH idempotency key", async () => {
    const sends: SendGiftInput[] = [];
    await render(
      <LiveGiftPanel
        catalogue={CATALOGUE}
        gifts={[]}
        canSend
        onSend={(input) => sends.push(input)}
      />,
    );
    // bump the quantity to 2 (within the frozen 1..10 law)
    await act(async () => {
      (q('button[aria-label="Increase quantity"]') as unknown as HTMLButtonElement).click();
    });
    await act(async () => {
      (q('[data-testid="gift-send"]') as unknown as HTMLButtonElement).click();
    });
    expect(sends.length).toBe(1);
    expect(sends[0]!.giftItemId).toBe("g-comet");
    expect(sends[0]!.quantity).toBe(2);
    expect(typeof sends[0]!.clientRequestId).toBe("string");
    expect(sends[0]!.clientRequestId.length).toBeGreaterThanOrEqual(8);
    expect("matchTeamId" in sends[0]!).toBe(false);
    // second click → a NEW clientRequestId (the per-click idempotency law)
    await act(async () => {
      (q('[data-testid="gift-send"]') as unknown as HTMLButtonElement).click();
    });
    expect(sends.length).toBe(2);
    expect(sends[1]!.clientRequestId).not.toBe(sends[0]!.clientRequestId);
  });

  test("the 'Support a side' picker appears ONLY with activeMatchTeams and passes matchTeamId through", async () => {
    // without sides → no picker, no matchTeamId
    const soloSends: SendGiftInput[] = [];
    await render(
      <LiveGiftPanel
        catalogue={CATALOGUE}
        gifts={[]}
        canSend
        onSend={(input) => soloSends.push(input)}
      />,
    );
    expect(q('[data-testid="gift-team-picker"]')).toBeNull();
    await act(async () => {
      (q('[data-testid="gift-send"]') as unknown as HTMLButtonElement).click();
    });
    expect(soloSends[0]!.matchTeamId).toBeUndefined();

    // with sides → the picker with "No side" default + both labels
    const sends: SendGiftInput[] = [];
    await render(
      <LiveGiftPanel
        catalogue={CATALOGUE}
        gifts={[]}
        canSend
        onSend={(input) => sends.push(input)}
        activeMatchTeams={[
          { id: "team-a", label: "Team A" },
          { id: "team-b", label: "Team B" },
        ]}
      />,
    );
    const picker = q('[data-testid="gift-team-picker"]');
    expect(picker).not.toBeNull();
    expect(picker!.textContent).toContain("Support a side");
    const select = q('select[aria-label="Support a side"]') as unknown as HTMLSelectElement;
    expect(select.value).toBe(""); // "No side" default
    await selectValue(select, "team-a");
    await act(async () => {
      (q('[data-testid="gift-send"]') as unknown as HTMLButtonElement).click();
    });
    expect(sends.length).toBe(1);
    expect(sends[0]!.matchTeamId).toBe("team-a");
  });

  test("a set error renders as a destructive alert line", async () => {
    await render(
      <LiveGiftPanel
        catalogue={CATALOGUE}
        gifts={[]}
        canSend
        error="You're out of dev credits for this window"
        onSend={noopSend}
      />,
    );
    const alert = q('[data-testid="gift-error"]');
    expect(alert).not.toBeNull();
    expect(alert!.getAttribute("role")).toBe("alert");
    expect(alert!.textContent).toContain("You're out of dev credits for this window");
  });

  test("empty catalogue: the honest dead end — 'Gift catalogue unavailable' + a permanently disabled send button", async () => {
    await render(<LiveGiftPanel catalogue={[]} gifts={[]} canSend onSend={noopSend} />);
    expect(q('[data-testid="gift-catalogue-empty"]')!.textContent).toContain(
      "Gift catalogue unavailable",
    );
    const send = q('[data-testid="gift-send"]') as unknown as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });

  test("the feed renders the server's newest-first order verbatim; empty → 'No gifts yet'", async () => {
    // empty
    await render(<LiveGiftPanel catalogue={CATALOGUE} gifts={[]} canSend onSend={noopSend} />);
    expect(host!.textContent).toContain("No gifts yet");

    // rows: "senderName sent N × giftName" with the server's totalCredits
    await render(
      <LiveGiftPanel
        catalogue={CATALOGUE}
        gifts={[
          giftEventFixture(),
          giftEventFixture({
            id: "gift-2",
            intentId: "intent-2",
            senderId: "sender-2",
            senderHandle: "bob",
            senderName: "Bob",
            giftItemId: "g-comet",
            giftName: "Comet Pop",
            animationKind: "burst",
            quantity: 1,
            totalCredits: 5,
          }),
        ]}
        canSend
        onSend={noopSend}
      />,
    );
    const rows = all('[data-testid="gift-feed"] li');
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toContain("Alice sent 2 × Sky Lantern");
    expect(rows[0]!.textContent).toContain("24 dev credits");
    expect(rows[1]!.textContent).toContain("Bob sent 1 × Comet Pop");
    expect(rows[1]!.textContent).toContain("5 dev credits");
  });
});
