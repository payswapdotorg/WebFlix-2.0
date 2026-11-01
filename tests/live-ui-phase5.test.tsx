/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Phase 5 — Lane 5-c (UI lane) tests: the fan-club UI
 * surfaces (viewer club panel + useLiveClub, chat club badge, host console
 * members-only toggle + fan-club manager card, preflight visibility).
 *
 * happy-dom + createRoot/act (the auth-ui harness pattern, mirroring
 * tests/live-ui-phase4.test.tsx exactly: same DOM bootstrap, same render/
 * cleanup helpers, the fetch-swap idiom — NO network, NO db, NO module
 * mocks; the club routes are a parallel lane's work and every fixture is
 * an inline typed FROZEN DTO with every field filled honestly).
 *
 * Pins (the 5-c row of the lane table):
 * - chat badge: the senderClubBadge renders as a neutral zinc "★ level"
 *   pill next to the name (never indigo/blue), null renders NOTHING;
 * - club panel: the frozen overview renders verbatim (name/motto/count/
 *   top members), missions are progress rows with the Done state, the
 *   ADR-0010 "Fan points — no cash value" framing is present wherever
 *   points show; signed-out → sign-in CTA; the join flow is optimistic
 *   (frozen 0-points/level-1 floor, "Syncing…") and reconciles to the
 *   server's projection; a failed join/leave ROLLS BACK with the server's
 *   honest copy; a load failure offers a working Retry; 404 is the honest
 *   "no club yet" state whose create CTA belongs to the HOST alone;
 * - host console: the members-only toggle POSTs the audited
 *   members-chat-enable/-disable action and rolls back on failure; the
 *   fan-club manager creates the club (honest error copy) and renders the
 *   count + roster; the preflight visibility select carries "members" with
 *   the honest explainer;
 * - 375px: the panel carries the structural overflow law (min-w-0/w-full
 *   root, max-h-96 bounded roster) and nothing renders wider than the bar.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act, useState } from "react";
import type { ReactElement } from "react";
import type {
  LiveChatMessageDto,
  LiveFanClubDto,
  LiveFanClubOverviewDto,
  LiveRoomPolicyDto,
} from "@/lib/live/types";
import type { UseLiveStreamResult } from "@/components/live/use-live-stream";

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

// ---- the surfaces (imported after the DOM exists, the harness law) ------
const { LiveChatPanel } = await import("@/components/live/live-chat-panel");
const { LiveClubPanel } = await import("@/components/live/live-club-panel");
const { ClubManagerCard, HostPolicyControls, PreflightCard } = await import(
  "@/app/studio/live/view"
);

// ---- fetch swap (the p36 idiom): controllable responses, recorded wire ---
const realFetch = globalThis.fetch;
const fetchLog: { url: string; init: RequestInit }[] = [];

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** The per-test responder (default: an empty 200 JSON body). */
let respond: (url: string, init: RequestInit) => Response | Promise<Response> =
  () => jsonResponse({});

beforeEach(() => {
  fetchLog.length = 0;
  respond = () => jsonResponse({});
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const i = init ?? {};
    fetchLog.push({ url: u, init: i });
    return respond(u, i);
  }) as unknown as typeof fetch;
});

// ---- harness -------------------------------------------------------------
let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): Element | null =>
  host ? (host.querySelector(sel) as unknown as Element | null) : null;
const all = (sel: string): Element[] =>
  host ? (Array.from(host.querySelectorAll(sel)) as unknown as Element[]) : [];

async function render(el: ReactElement) {
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

/** Let the mocked fetch chain + the resulting state update settle. */
async function flush() {
  await act(async () => {
    await sleep(0);
  });
}

async function click(testId: string): Promise<void> {
  const button = q(`[data-testid="${testId}"]`) as unknown as HTMLButtonElement | null;
  if (!button) throw new Error(`missing button ${testId}`);
  await act(async () => {
    button.click();
  });
  await flush();
}

/** React-safe input set (the feedback-form typeInto convention):
 * focusin, the prototype value setter, then a keyup to flush React's
 * value-tracker change extraction. */
async function setInput(selector: string, value: string): Promise<void> {
  const el = q(selector) as unknown as HTMLInputElement;
  if (!el) throw new Error(`missing input ${selector}`);
  await act(async () => {
    el.dispatchEvent(new Event("focusin", { bubbles: true }));
  });
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  desc?.set?.call(el, value);
  await act(async () => {
    el.dispatchEvent(new Event("keyup", { bubbles: true }));
  });
}

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
  globalThis.fetch = realFetch;
});

// ═══════════════════════════════════════════════════════════════════
// Fixtures — typed frozen DTOs, every field filled honestly.
// ═══════════════════════════════════════════════════════════════════

const T0 = "2026-11-04T12:00:00.000Z";
const HOST = "host-5c";
const CLUBS_BASE = "/api/live-clubs";

function clubFixture(over: Partial<LiveFanClubDto> = {}): LiveFanClubDto {
  return {
    id: "club-5c",
    hostId: HOST,
    hostHandle: "hostly",
    hostName: "Hostly Host",
    name: "Hostly Heroes",
    motto: "No cash, just vibes",
    memberCount: 12,
    pointsPerLevel: 500,
    createdAt: T0,
    ...over,
  };
}

function overviewFixture(over: Partial<LiveFanClubOverviewDto> = {}): LiveFanClubOverviewDto {
  return {
    club: clubFixture(),
    membership: null,
    missions: [
      { key: "first-steps", label: "Join 1 live session", done: false, progress: 0, goal: 1 },
      { key: "voice", label: "Send 10 chat messages", done: false, progress: 4, goal: 10 },
      { key: "supporter", label: "Send 1 gift in a host room", done: true, progress: 1, goal: 1 },
    ],
    topMembers: [
      {
        userId: "member-1",
        handle: "clubby",
        name: "Clubby Member",
        points: 1204,
        level: 3,
        joinedAt: T0,
      },
      {
        userId: "member-2",
        handle: "freshfan",
        name: "Fresh Fan",
        points: 8,
        level: 1,
        joinedAt: T0,
      },
    ],
    liveRoom: null,
    ...over,
  };
}

const MEMBERSHIP = { points: 120, level: 1, joinedAt: T0 };

const POLICY: LiveRoomPolicyDto = {
  chatEnabled: true,
  reactionsEnabled: true,
  slowModeSeconds: 0,
  guestsEnabled: true,
  giftsEnabled: true,
  membersOnlyChat: false,
  blockLinks: false,
  actorRole: "viewer",
  canChat: true,
  chatBlockedReason: null,
};

function msgFixture(over: Partial<LiveChatMessageDto> = {}): LiveChatMessageDto {
  return {
    id: "m-5c",
    seq: 12,
    roomId: "room-5c",
    sessionId: "sess-5c",
    senderId: "member-9",
    senderHandle: "clubby",
    senderName: "Clubby Member",
    kind: "chat",
    body: "hi from the club",
    createdAt: T0,
    deleted: false,
    senderClubBadge: { clubName: "Hostly Heroes", level: 3 },
    ...over,
  };
}

/** A minimal page stream stand-in (the panels receive slices as props). */
function fakeStream(messages: LiveChatMessageDto[]): UseLiveStreamResult {
  return {
    messages,
    reactionTotal: null,
    viewerCount: null,
    connected: true,
    latestEnvelope: null,
  };
}

// ═══════════════════════════════════════════════════════════════════
// The chat club badge
// ═══════════════════════════════════════════════════════════════════

describe("5-c chat club badge — server-derived, neutral, null renders nothing", () => {
  test("a member message renders the zinc ★ level pill next to the name (never indigo/blue)", async () => {
    await render(
      <LiveChatPanel
        roomId="room-5c"
        sessionLive
        policy={POLICY}
        canModerate={false}
        signedIn
        stream={fakeStream([msgFixture()])}
      />,
    );
    await flush();
    const badge = q('[data-testid="chat-club-badge"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain("★");
    expect(badge!.textContent).toContain("3");
    expect(badge!.getAttribute("title")).toContain("Hostly Heroes");
    const cls = badge!.className;
    expect(cls).toContain("zinc"); // the neutral-tone law
    expect(cls).not.toContain("indigo");
    expect(cls).not.toContain("blue");
    // it sits next to the sender's name in the same row
    expect(badge!.parentElement!.textContent).toContain("Clubby Member");
  });

  test("a null badge renders NOTHING — a badge is never client-claimed", async () => {
    await render(
      <LiveChatPanel
        roomId="room-5c"
        sessionLive
        policy={POLICY}
        canModerate={false}
        signedIn
        stream={fakeStream([msgFixture({ senderClubBadge: null })])}
      />,
    );
    await flush();
    expect(q('[data-testid="chat-club-badge"]')).toBeNull();
    // the message itself still renders
    expect(host!.textContent).toContain("hi from the club");
  });
});

// ═══════════════════════════════════════════════════════════════════
// LiveClubPanel — the viewer club panel
// ═══════════════════════════════════════════════════════════════════

describe("5-c LiveClubPanel — the frozen overview, verbatim", () => {
  test("club header, motto, member count, top members with points/levels, ADR-0010 framing everywhere points show", async () => {
    respond = () => jsonResponse(overviewFixture({ membership: MEMBERSHIP }));
    await render(<LiveClubPanel hostId={HOST} signedIn hostName="Hostly Host" />);
    await flush();

    expect(q('[data-testid="club-name"]')!.textContent).toContain("Hostly Heroes");
    expect(host!.textContent).toContain("No cash, just vibes");
    expect(q('[data-testid="club-member-count"]')!.textContent).toContain("12");
    // the caller's membership: the server's projection, verbatim
    expect(q('[data-testid="club-member-card"]')).not.toBeNull();
    expect(q('[data-testid="club-my-level"]')!.textContent).toContain("Level 1");
    expect(q('[data-testid="club-my-points"]')!.textContent).toContain("120 fan points");
    // the ADR-0010 law: the framing label rides EVERY points surface
    expect(q('[data-testid="club-points-note"]')!.textContent).toContain(
      "Fan points — no cash value",
    );
    expect(q('[data-testid="club-cash-note"]')!.textContent).toContain("no cash value");
    // the bounded roster with its long-list law
    const list = q('[data-testid="club-member-list"]')!;
    expect(list.className).toContain("max-h-96");
    expect(list.className).toContain("overflow-y-auto");
    const rows = all('[data-testid="club-member"]');
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toContain("Clubby Member");
    expect(rows[0]!.textContent).toContain("Lv 3 · 1204 pts");
    expect(rows[1]!.textContent).toContain("Lv 1 · 8 pts");
  });

  test("missions are simple progress rows — label + progress/goal + the server's done state", async () => {
    respond = () => jsonResponse(overviewFixture({}));
    await render(<LiveClubPanel hostId={HOST} signedIn hostName="Hostly Host" />);
    await flush();

    const missions = all('[data-testid="club-mission"]');
    expect(missions.length).toBe(3);
    expect(missions[0]!.textContent).toContain("Join 1 live session");
    expect(missions[0]!.textContent).toContain("0/1");
    expect(missions[0]!.getAttribute("data-done")).toBe("false");
    expect(missions[1]!.textContent).toContain("4/10");
    expect(missions[2]!.getAttribute("data-done")).toBe("true");
    expect(missions[2]!.textContent).toContain("Done");
    expect(missions[2]!.textContent).toContain("1/1");
  });

  test("signed-out: the join CTA prompts sign-in (no editable join, no fake membership)", async () => {
    respond = () => jsonResponse(overviewFixture({}));
    await render(
      <LiveClubPanel
        hostId={HOST}
        signedIn={false}
        hostName="Hostly Host"
        signInHref="/signin?redirect=%2Flive%2Froom-5c"
      />,
    );
    await flush();

    const signin = q('[data-testid="club-signin"]');
    expect(signin).not.toBeNull();
    expect(signin!.textContent).toContain("Sign in to join the fan club");
    // asChild: the Link IS the rendered anchor carrying the testid
    expect((signin as unknown as HTMLElement).tagName).toBe("A");
    expect(signin!.getAttribute("href")).toContain("/signin");
    expect(q('[data-testid="club-join"]')).toBeNull();
    expect(q('[data-testid="club-member-card"]')).toBeNull();
  });

  test("join flow: the optimistic window shows the frozen 0-points/level-1 floor labelled syncing, then the server's projection replaces it", async () => {
    let joined = false;
    let releaseJoin: (() => void) | null = null;
    respond = (url, init) => {
      const u = String(url);
      if ((init.method ?? "GET") === "POST" && u === `${CLUBS_BASE}/${HOST}/join`) {
        return new Promise<Response>((resolve) => {
          releaseJoin = () => resolve(jsonResponse({}));
        });
      }
      return jsonResponse(
        overviewFixture({ membership: joined ? MEMBERSHIP : null }),
      );
    };
    await render(<LiveClubPanel hostId={HOST} signedIn hostName="Hostly Host" />);
    await flush();
    expect(q('[data-testid="club-join"]')).not.toBeNull();

    await click("club-join");
    // the optimistic intent — honest floor, never a fabricated server answer
    expect(q('[data-testid="club-member-card"]')).not.toBeNull();
    expect(q('[data-testid="club-my-points"]')!.textContent).toContain("0 fan points");
    expect(q('[data-testid="club-my-level"]')!.textContent).toContain("Level 1");
    expect(host!.textContent).toContain("Syncing your membership…");

    joined = true;
    await act(async () => {
      releaseJoin?.();
    });
    await flush();

    // the server's overview is the truth — the intent is replaced
    expect(q('[data-testid="club-my-points"]')!.textContent).toContain("120 fan points");
    expect(host!.textContent).not.toContain("Syncing your membership…");
    const joinCall = fetchLog.find(
      (c) => c.init.method === "POST" && c.url.includes("/join"),
    );
    expect(joinCall).toBeDefined();
    expect(joinCall!.init.body).toBe("{}");
  });

  test("a failed join rolls back (no member card) and renders the server's honest copy", async () => {
    respond = (url, init) => {
      if ((init.method ?? "GET") === "POST") {
        return jsonResponse({ error: "forbidden", message: "This club is full." }, 403);
      }
      return jsonResponse(overviewFixture({}));
    };
    await render(<LiveClubPanel hostId={HOST} signedIn hostName="Hostly Host" />);
    await flush();

    await click("club-join");
    await flush();

    expect(q('[data-testid="club-member-card"]')).toBeNull(); // rolled back
    expect(q('[data-testid="club-join"]')).not.toBeNull();
    expect(
      (q('[data-testid="club-join"]') as unknown as HTMLButtonElement).disabled,
    ).toBe(false);
    const alert = q('[data-testid="club-action-error"]');
    expect(alert).not.toBeNull();
    expect(alert!.getAttribute("role")).toBe("alert");
    expect(alert!.textContent).toContain("This club is full.");
  });

  test("leave flow: the optimistic hide, the audited POST, then the join CTA returns", async () => {
    let left = false;
    respond = (url, init) => {
      const u = String(url);
      if ((init.method ?? "GET") === "POST" && u === `${CLUBS_BASE}/${HOST}/leave`) {
        left = true;
        return jsonResponse({});
      }
      return jsonResponse(
        overviewFixture({ membership: left ? null : MEMBERSHIP }),
      );
    };
    await render(<LiveClubPanel hostId={HOST} signedIn hostName="Hostly Host" />);
    await flush();
    expect(q('[data-testid="club-member-card"]')).not.toBeNull();

    await click("club-leave");
    await flush();

    const leaveCall = fetchLog.find(
      (c) => c.init.method === "POST" && c.url.includes("/leave"),
    );
    expect(leaveCall).toBeDefined();
    expect(leaveCall!.init.body).toBe("{}");
    expect(q('[data-testid="club-member-card"]')).toBeNull();
    expect(q('[data-testid="club-join"]')).not.toBeNull();
  });

  test("a load failure is a real failure with a working Retry — never an empty club", async () => {
    respond = () => jsonResponse({ error: "provider-failed", message: "ledger offline" }, 500);
    await render(<LiveClubPanel hostId={HOST} signedIn hostName="Hostly Host" />);
    await flush();
    expect(q('[data-testid="club-error"]')).not.toBeNull();
    expect(host!.textContent).toContain("ledger offline");
    expect(q('[data-testid="club-name"]')).toBeNull();

    respond = () => jsonResponse(overviewFixture({}));
    await click("club-retry");
    await flush();
    expect(q('[data-testid="club-name"]')!.textContent).toContain("Hostly Heroes");
  });

  test("404 is the honest 'no club yet' state — a viewer gets no create CTA", async () => {
    respond = () => jsonResponse({ error: "not-found" }, 404);
    await render(<LiveClubPanel hostId={HOST} signedIn hostName="Hostly Host" />);
    await flush();
    expect(q('[data-testid="club-empty"]')).not.toBeNull();
    expect(host!.textContent).toContain("hasn't started a fan club yet");
    expect(q('[data-testid="club-create-form"]')).toBeNull();
  });

  test("host + no club: the create CTA posts the frozen CreateLiveFanClubInput and the fresh overview replaces the empty state", async () => {
    let created = false;
    respond = (url, init) => {
      const u = String(url);
      if ((init.method ?? "GET") === "POST" && u === CLUBS_BASE) {
        created = true;
        return jsonResponse({ club: clubFixture() });
      }
      return created
        ? jsonResponse(overviewFixture({}))
        : jsonResponse({ error: "not-found" }, 404);
    };
    await render(
      <LiveClubPanel hostId={HOST} signedIn isHost hostName="Hostly Host" />,
    );
    await flush();
    expect(q('[data-testid="club-create-form"]')).not.toBeNull();
    expect(q('[data-testid="club-create"]')!.textContent).toContain("Create fan club");

    await setInput('input[aria-label="Club name"]', "Hostly Heroes");
    await setInput('input[aria-label="Club motto (optional)"]', "No cash, just vibes");
    await click("club-create");
    await flush();

    const createCall = fetchLog.find(
      (c) => c.init.method === "POST" && c.url === CLUBS_BASE,
    );
    expect(createCall).toBeDefined();
    expect(createCall!.init.body).toBe(
      '{"name":"Hostly Heroes","motto":"No cash, just vibes"}',
    );
    expect(q('[data-testid="club-name"]')!.textContent).toContain("Hostly Heroes");
    expect(q('[data-testid="club-empty"]')).toBeNull();
  });

  test("a failed create never fakes success — the honest error line, form intact", async () => {
    respond = (url, init) => {
      if ((init.method ?? "GET") === "POST") {
        return jsonResponse({ error: "conflict", message: "You already have a fan club." }, 409);
      }
      return jsonResponse({ error: "not-found" }, 404);
    };
    await render(
      <LiveClubPanel hostId={HOST} signedIn isHost hostName="Hostly Host" />,
    );
    await flush();
    await setInput('input[aria-label="Club name"]', "Hostly Heroes");
    await click("club-create");
    await flush();

    const alert = q('[data-testid="club-create-error"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain("You already have a fan club.");
    expect(q('[data-testid="club-empty"]')).not.toBeNull(); // still honest
    expect(q('[data-testid="club-name"]')).toBeNull(); // no club was faked
  });

  test("375px: the structural overflow law — min-w-0/w-full root, bounded roster, nothing wider than the bar", async () => {
    respond = () => jsonResponse(overviewFixture({ membership: MEMBERSHIP }));
    await render(<LiveClubPanel hostId={HOST} signedIn hostName="Hostly Host" />);
    await flush();
    // the phone bar: happy-dom has no layout engine, so this pins the
    // STRUCTURAL contract — every element reports a scrollWidth within the
    // 375px container and the root carries the live panels' overflow guards.
    host!.setAttribute("style", "width:375px;overflow:hidden");
    for (const el of all("*")) {
      const sw = (el as unknown as HTMLElement).scrollWidth;
      if (sw > 0) expect(sw).toBeLessThanOrEqual(375);
    }
    const card = q('[data-testid="live-club-panel"]')!;
    expect(card.className).toContain("min-w-0");
    expect(card.className).toContain("w-full");
    const list = q('[data-testid="club-member-list"]')!;
    expect(list.className).toContain("max-h-96");
    expect(list.className).toContain("overflow-y-auto");
  });
});

// ═══════════════════════════════════════════════════════════════════
// HostPolicyControls — the members-only chat gate
// ═══════════════════════════════════════════════════════════════════

/** Stateful harness — the parent owns the policy state, exactly like the console. */
function PolicyHarness({ changes }: { changes: string[] }) {
  const [chatEnabled, setChatEnabled] = useState(true);
  const [slowModeSeconds, setSlowModeSeconds] = useState(0);
  const [membersOnlyChat, setMembersOnlyChat] = useState(false);
  return (
    <HostPolicyControls
      roomId="room-5c"
      chatEnabled={chatEnabled}
      slowModeSeconds={slowModeSeconds}
      membersOnlyChat={membersOnlyChat}
      onChatEnabled={(v) => {
        changes.push(`chat:${v}`);
        setChatEnabled(v);
      }}
      onSlowMode={setSlowModeSeconds}
      onMembersOnlyChat={(v) => {
        changes.push(`members:${v}`);
        setMembersOnlyChat(v);
      }}
    />
  );
}

describe("5-c members-only chat toggle — the audited moderation actions", () => {
  test("switching on POSTs members-chat-enable; switching off POSTs members-chat-disable", async () => {
    const changes: string[] = [];
    await render(<PolicyHarness changes={changes} />);
    await flush();

    const toggle = () =>
      q('[data-testid="live-policy-members-chat"]') as unknown as HTMLButtonElement;
    expect(toggle()).not.toBeNull();

    await act(async () => {
      toggle().click();
    });
    await flush();
    expect(changes).toEqual(["members:true"]);
    const enable = fetchLog.find(
      (c) => c.init.method === "POST" && c.url.includes("/moderation"),
    );
    expect(enable).toBeDefined();
    expect(enable!.init.body).toBe('{"action":"members-chat-enable"}');

    await act(async () => {
      toggle().click();
    });
    await flush();
    expect(changes).toEqual(["members:true", "members:false"]);
    const disable = fetchLog.filter((c) => c.url.includes("/moderation")).pop();
    expect(disable!.init.body).toBe('{"action":"members-chat-disable"}');
  });

  test("a failed toggle rolls the mirror back — the UI keeps the server-confirmed truth", async () => {
    respond = () => jsonResponse({ error: "forbidden" }, 403);
    const changes: string[] = [];
    await render(<PolicyHarness changes={changes} />);
    await flush();

    await act(async () => {
      (
        q('[data-testid="live-policy-members-chat"]') as unknown as HTMLButtonElement
      ).click();
    });
    await flush();

    // the optimistic set happened, then the rollback restored the previous value
    expect(changes).toEqual(["members:true", "members:false"]);
    expect(
      (
        q('[data-testid="live-policy-members-chat"]') as unknown as HTMLButtonElement
      ).getAttribute("data-state"),
    ).toBe("unchecked");
  });
});

// ═══════════════════════════════════════════════════════════════════
// ClubManagerCard — the studio fan-club manager
// ═══════════════════════════════════════════════════════════════════

describe("5-c ClubManagerCard — create flow, honest error, roster", () => {
  test("no club → create form; a successful create POSTs the frozen input and renders the roster", async () => {
    let created = false;
    respond = (url, init) => {
      const u = String(url);
      if (u.startsWith("/api/auth/session")) {
        return jsonResponse({
          user: { id: HOST, name: "Hostly Host", email: "h@wfx.test", avatarSeed: 1 },
        });
      }
      if ((init.method ?? "GET") === "POST" && u === CLUBS_BASE) {
        created = true;
        return jsonResponse({ club: clubFixture() });
      }
      return created
        ? jsonResponse(overviewFixture({}))
        : jsonResponse({ error: "not-found" }, 404);
    };
    await render(<ClubManagerCard />);
    await flush();

    expect(q('[data-testid="club-manager-create-form"]')).not.toBeNull();
    expect(q('[data-testid="club-manager-signin"]')).toBeNull();

    await setInput('input[aria-label="Club name"]', "Hostly Heroes");
    await click("club-manager-create");
    await flush();

    const createCall = fetchLog.find(
      (c) => c.init.method === "POST" && c.url === CLUBS_BASE,
    );
    expect(createCall).toBeDefined();
    expect(createCall!.init.body).toBe('{"name":"Hostly Heroes"}');
    expect(q('[data-testid="club-manager-name"]')!.textContent).toContain("Hostly Heroes");
    expect(q('[data-testid="club-manager-count"]')!.textContent).toContain("12");
    expect(q('[data-testid="club-points-note"]')!.textContent).toContain(
      "Fan points — no cash value",
    );
  });

  test("a failed create renders the server's honest copy and never fakes a club", async () => {
    respond = (url, init) => {
      const u = String(url);
      if (u.startsWith("/api/auth/session")) {
        return jsonResponse({
          user: { id: HOST, name: "Hostly Host", email: "h@wfx.test", avatarSeed: 1 },
        });
      }
      if ((init.method ?? "GET") === "POST") {
        return jsonResponse({ error: "conflict", message: "One club per creator." }, 409);
      }
      return jsonResponse({ error: "not-found" }, 404);
    };
    await render(<ClubManagerCard />);
    await flush();

    await setInput('input[aria-label="Club name"]', "Hostly Heroes");
    await click("club-manager-create");
    await flush();

    expect(q('[data-testid="club-manager-create-error"]')!.textContent).toContain(
      "One club per creator.",
    );
    expect(q('[data-testid="club-manager-name"]')).toBeNull();
    expect(q('[data-testid="club-manager-create-form"]')).not.toBeNull();
  });

  test("an existing club renders the member count + the bounded top-members roster", async () => {
    respond = (url) => {
      if (String(url).startsWith("/api/auth/session")) {
        return jsonResponse({
          user: { id: HOST, name: "Hostly Host", email: "h@wfx.test", avatarSeed: 1 },
        });
      }
      return jsonResponse(overviewFixture({}));
    };
    await render(<ClubManagerCard />);
    await flush();

    expect(q('[data-testid="club-manager-count"]')!.textContent).toContain("12");
    const rows = all('[data-testid="club-manager-member"]');
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toContain("Clubby Member");
    expect(rows[0]!.textContent).toContain("Lv 3 · 1204 pts");
    const members = q('[data-testid="club-manager-members"]')!;
    expect(members.className).toContain("max-h-96");
    expect(members.className).toContain("overflow-y-auto");
  });
});

// ═══════════════════════════════════════════════════════════════════
// PreflightCard — the "members" visibility option
// ═══════════════════════════════════════════════════════════════════

function PreflightHarness({
  onVisibility,
}: {
  onVisibility: (v: "public" | "unlisted" | "members") => void;
}) {
  const [title, setTitle] = useState("Season finale");
  const [visibility, setVisibility] = useState<"public" | "unlisted" | "members">("public");
  return (
    <PreflightCard
      title={title}
      onTitleChange={setTitle}
      visibility={visibility}
      onVisibilityChange={(v) => {
        setVisibility(v);
        onVisibility(v);
      }}
      starting={false}
      formError={null}
      providerFailure={null}
      onRetryStart={async () => {}}
      permState="ask"
      deviceError={null}
      cameras={[]}
      mics={[]}
      cameraId=""
      micId=""
      previewVideoRef={{ current: null }}
      onDeviceTest={async () => {}}
      onGoLive={async () => {}}
    />
  );
}

describe("5-c preflight visibility — the honest members option", () => {
  test("the select carries public/unlisted/members; members shows the honest explainer and reaches Go Live", async () => {
    const picked: string[] = [];
    await render(<PreflightHarness onVisibility={(v) => picked.push(v)} />);
    await flush();

    const select = q("#go-live-visibility") as unknown as HTMLSelectElement;
    expect(select).not.toBeNull();
    const options = Array.from(select.options);
    expect(options.map((o) => o.value)).toEqual(["public", "unlisted", "members"]);
    expect(options[2]!.textContent).toContain("only your fan-club members can join this room");
    // public/unlisted show no members note
    expect(q('[data-testid="visibility-members-note"]')).toBeNull();

    await selectValue(select, "members");
    await flush();

    expect(picked).toEqual(["members"]);
    const note = q('[data-testid="visibility-members-note"]');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain("Only your fan-club members can join this room.");
  });
});
