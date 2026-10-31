/// <reference types="bun-types" />
/**
 * WFX2-LIVE-PLATFORM-1 Phase 5-emotes — lane E-c (UI) tests: the chat
 * picker + segment rendering and the studio emote manager.
 *
 * happy-dom + createRoot/act (the auth-ui harness pattern, mirroring
 * tests/live-ui-phase5.test.tsx exactly: same DOM bootstrap, same render/
 * cleanup helpers, the fetch-swap idiom — NO network, NO db; every fixture
 * is an inline typed FROZEN DTO with every field filled honestly). sonner
 * is mocked with the house recorder (the stats-for-nerds idiom) so the
 * manager's verbatim error toast is assertable.
 *
 * Pins (the E-c row of the lane table, contract §6):
 * - the FROZEN render module: exact :code: matches split into text/emote
 *   segments; unknown codes, scores, times and improvised smilies stay
 *   literal text; empty body → []; adjacency renders two glyph rows;
 * - the picker: the entitled glyph is a clickable row that appends
 *   ":code: " to the composer; the locked row is DISABLED with the lock +
 *   "Level N"; the club name headers the popover; zero emotes (or a fetch
 *   failure) HIDES the picker and never breaks chat; no hostId → no fetch
 *   and plain-text bodies (backward-compat law);
 * - message bodies render the server map's unicode as a React text node
 *   (title/aria-label carry the code) — never the literal token, never HTML;
 * - the studio manager: rows render glyphs + Level N; save POSTs the frozen
 *   payload and refreshes from the server; delete DELETEs the exact code;
 *   a 404 no-club save surfaces the server's message VERBATIM as an error
 *   toast and fakes nothing.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import type {
  LiveChatMessageDto,
  LiveClubEmotesDto,
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

// ---- sonner recorder (the house toast idiom) — BEFORE the imports -------
const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((m: string) => toasts.push(String(m)), {
    success: (m: string) => toasts.push(`success:${m}`),
    error: (m: string) => toasts.push(`error:${m}`),
    info: (m: string) => toasts.push(`info:${m}`),
  }),
}));

// ---- the surfaces (imported after the DOM exists, the harness law) ------
const { renderEmoteSegments } = await import("@/lib/live/emote-render");
const { LiveChatPanel } = await import("@/components/live/live-chat-panel");
const { ClubManagerCard } = await import("@/app/studio/live/view");

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
  toasts.length = 0;
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

/** The club-card chain is session → overview → emotes; settle every hop. */
async function flushAll() {
  for (let i = 0; i < 5; i += 1) {
    await flush();
  }
}

async function click(testId: string): Promise<void> {
  const button = q(`[data-testid="${testId}"]`) as unknown as HTMLButtonElement | null;
  if (!button) throw new Error(`missing button ${testId}`);
  await act(async () => {
    button.click();
  });
  await flush();
}

/** React-safe input set (the feedback-form typeInto convention). */
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
const HOST = "host-ec";
const EMOTES_BASE = "/api/live-clubs/emotes";

const POLICY: LiveRoomPolicyDto = {
  chatEnabled: true,
  reactionsEnabled: true,
  slowModeSeconds: 0,
  guestsEnabled: true,
  giftsEnabled: true,
  membersOnlyChat: false,
  actorRole: "viewer",
  canChat: true,
  chatBlockedReason: null,
};

function msgFixture(over: Partial<LiveChatMessageDto> = {}): LiveChatMessageDto {
  return {
    id: "m-ec",
    seq: 12,
    roomId: "room-ec",
    sessionId: "sess-ec",
    senderId: "member-9",
    senderHandle: "clubby",
    senderName: "Clubby Member",
    kind: "chat",
    body: "hi from the club",
    createdAt: T0,
    deleted: false,
    senderClubBadge: null,
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

type EmoteRow = LiveClubEmotesDto["emotes"][number];

/** The frozen GET map — the caller's entitlement stamped server-side. */
function emotesDto(emotes: EmoteRow[], clubName: string | null = "Hostly Heroes"): LiveClubEmotesDto {
  return { hostId: HOST, clubName, emotes };
}

/** Two-emote map: heart entitled (level 1), flame locked behind level 5. */
function twoEmoteMap(): EmoteRow[] {
  return [
    { code: "heart", unicode: "❤️", requiredLevel: 1, entitled: true },
    { code: "flame", unicode: "🔥", requiredLevel: 5, entitled: false },
  ];
}

// ═══════════════════════════════════════════════════════════════════
// The FROZEN render module (consumed, never re-implemented)
// ═══════════════════════════════════════════════════════════════════

describe("E-c renderEmoteSegments — the frozen substitution law", () => {
  test("an exact match splits text/emote segments with the code attached", () => {
    const segs = renderEmoteSegments("hello :heart:", [{ code: "heart", unicode: "❤️" }]);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ kind: "text", value: "hello " });
    expect(segs[1]).toEqual({ kind: "emote", value: "❤️", code: "heart" });
  });

  test("unknown codes, scores/times/smilies stay literal text; empty body → []", () => {
    const ghost = renderEmoteSegments("yo :ghost: yo", [{ code: "heart", unicode: "❤️" }]);
    expect(ghost).toEqual([{ kind: "text", value: "yo :ghost: yo" }]);
    const scores = renderEmoteSegments("2:1 10:30 :)", twoEmoteMap());
    expect(scores).toEqual([{ kind: "text", value: "2:1 10:30 :)" }]);
    expect(renderEmoteSegments("", twoEmoteMap())).toEqual([]);
  });

  test("multiple emotes + adjacency render back-to-back glyph segments", () => {
    const segs = renderEmoteSegments(":heart::flame: go", twoEmoteMap());
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ kind: "emote", value: "❤️", code: "heart" });
    expect(segs[1]).toEqual({ kind: "emote", value: "🔥", code: "flame" });
    expect(segs[2]).toEqual({ kind: "text", value: " go" });
    const spread = renderEmoteSegments("a :heart: b", twoEmoteMap());
    expect(spread.map((s) => s.kind)).toEqual(["text", "emote", "text"]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// LiveChatPanel — the picker + the message-body rendering
// ═══════════════════════════════════════════════════════════════════

describe("E-c chat picker — honest entitled/locked rows", () => {
  test("the picker renders both rows: entitled clickable, locked disabled with the Level 5 lock; the club name headers it", async () => {
    respond = (url) =>
      String(url).startsWith(EMOTES_BASE) ? jsonResponse(emotesDto(twoEmoteMap())) : jsonResponse({});
    await render(
      <LiveChatPanel
        roomId="room-ec"
        sessionLive
        policy={POLICY}
        canModerate={false}
        signedIn
        stream={fakeStream([msgFixture()])}
        hostId={HOST}
      />,
    );
    await flush();
    await flush();

    // the map fetch fired exactly once, with the encoded host id
    const mapFetches = fetchLog.filter((c) => c.url.startsWith(EMOTES_BASE));
    expect(mapFetches.length).toBe(1);
    expect(mapFetches[0]!.url).toBe(`${EMOTES_BASE}?hostId=${HOST}`);

    const trigger = q('[data-testid="emote-picker-trigger"]');
    expect(trigger).not.toBeNull();
    expect(trigger!.getAttribute("aria-label")).toBe("Emotes");

    await click("emote-picker-trigger");
    const picker = q('[data-testid="emote-picker"]');
    expect(picker).not.toBeNull();
    expect(picker!.textContent).toContain("Hostly Heroes"); // the club header

    const rows = all('[data-testid="emote-row"]');
    expect(rows.length).toBe(2); // BOTH rows show
    const locked = rows.find((r) => (r as unknown as HTMLButtonElement).disabled === true)!;
    const entitled = rows.find((r) => (r as unknown as HTMLButtonElement).disabled === false)!;
    expect(entitled.textContent).toContain(":heart:");
    expect(locked.getAttribute("aria-disabled")).toBe("true");
    expect(locked.getAttribute("title")).toBe("Unlocks at club level 5");
    expect(locked.textContent).toContain("Level 5");
    expect(locked.textContent).toContain(":flame:");
    expect(locked.querySelector("svg")).not.toBeNull(); // the lucide Lock

    // 375px law: the open popover never overflows a phone viewport
    host!.setAttribute("style", "width:375px;overflow:hidden");
    for (const el of all("*")) {
      const sw = (el as unknown as HTMLElement).scrollWidth;
      if (sw > 0) expect(sw).toBeLessThanOrEqual(375);
    }
  });

  test("clicking the entitled row appends ':heart: ' to the composer and closes the picker", async () => {
    respond = (url) =>
      String(url).startsWith(EMOTES_BASE) ? jsonResponse(emotesDto(twoEmoteMap())) : jsonResponse({});
    await render(
      <LiveChatPanel
        roomId="room-ec"
        sessionLive
        policy={POLICY}
        canModerate={false}
        signedIn
        stream={fakeStream([])}
        hostId={HOST}
      />,
    );
    await flush();
    await flush();

    await click("emote-picker-trigger");
    const rows = all('[data-testid="emote-row"]') as unknown as HTMLButtonElement[];
    const entitled = rows.find((r) => !r.disabled);
    expect(entitled).toBeDefined();
    await act(async () => {
      entitled!.click();
    });
    await flush();

    const textarea = q('textarea[aria-label="Chat message"]') as unknown as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toBe(":heart: ");
    expect(q('[data-testid="emote-picker"]')).toBeNull(); // closed after the pick
  });

  test("a map fetch failure keeps the picker hidden and chat intact — a failure NEVER breaks chat", async () => {
    respond = (url) =>
      String(url).startsWith(EMOTES_BASE)
        ? jsonResponse({ error: "provider-failed", message: "ledger offline" }, 502)
        : jsonResponse({});
    await render(
      <LiveChatPanel
        roomId="room-ec"
        sessionLive
        policy={POLICY}
        canModerate={false}
        signedIn
        stream={fakeStream([msgFixture({ body: "plain words" })])}
        hostId={HOST}
      />,
    );
    await flush();
    await flush();

    expect(q('[data-testid="emote-picker-trigger"]')).toBeNull();
    expect(host!.textContent).toContain("plain words");
  });
});

describe("E-c message body rendering — segments, never HTML, never literals", () => {
  test("a received ':heart:' renders the map's ❤️ glyph span with title/aria, and not the literal token", async () => {
    respond = (url) =>
      String(url).startsWith(EMOTES_BASE) ? jsonResponse(emotesDto(twoEmoteMap())) : jsonResponse({});
    await render(
      <LiveChatPanel
        roomId="room-ec"
        sessionLive
        policy={POLICY}
        canModerate={false}
        signedIn
        stream={fakeStream([msgFixture({ body: "hi :heart: fans" })])}
        hostId={HOST}
      />,
    );
    await flush();
    await flush();

    const glyph = q('span[title=":heart:"]');
    expect(glyph).not.toBeNull();
    expect(glyph!.getAttribute("aria-label")).toBe("emote :heart:");
    expect(glyph!.textContent).toBe("❤️");
    expect(glyph!.className).toContain("text-base");
    // the row renders "hi ❤️ fans" — no literal token, no raw HTML
    expect(host!.textContent).toContain("hi ❤️ fans");
    expect(host!.textContent).not.toContain(":heart:");
    expect(host!.innerHTML).not.toContain("<img");
  });

  test("a zero-emote map hides the picker and bodies render plain text (the honest history)", async () => {
    respond = (url) =>
      String(url).startsWith(EMOTES_BASE)
        ? jsonResponse(emotesDto([], "Hostly Heroes"))
        : jsonResponse({});
    await render(
      <LiveChatPanel
        roomId="room-ec"
        sessionLive
        policy={POLICY}
        canModerate={false}
        signedIn
        stream={fakeStream([msgFixture({ body: "hello :heart:" })])}
        hostId={HOST}
      />,
    );
    await flush();
    await flush();

    expect(q('[data-testid="emote-picker-trigger"]')).toBeNull();
    expect(q('span[title=":heart:"]')).toBeNull();
    expect(host!.textContent).toContain("hello :heart:"); // literal, honest
  });

  test("no hostId prop → no emote fetch fires and bodies render plain (backward-compat law)", async () => {
    await render(
      <LiveChatPanel
        roomId="room-ec"
        sessionLive
        policy={POLICY}
        canModerate={false}
        signedIn
        stream={fakeStream([msgFixture({ body: "hello :heart:" })])}
      />,
    );
    await flush();
    await flush();

    expect(fetchLog.some((c) => c.url.startsWith(EMOTES_BASE))).toBe(false);
    expect(q('[data-testid="emote-picker-trigger"]')).toBeNull();
    expect(host!.textContent).toContain("hello :heart:");
    expect(q('span[title=":heart:"]')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// ClubManagerCard — the studio emote manager
// ═══════════════════════════════════════════════════════════════════

function clubOverviewBody(): Record<string, unknown> {
  return {
    club: {
      id: "club-ec",
      hostId: HOST,
      hostHandle: "hostly",
      hostName: "Hostly Host",
      name: "Hostly Heroes",
      motto: "No cash, just vibes",
      memberCount: 12,
      pointsPerLevel: 500,
      createdAt: T0,
    },
    membership: null,
    missions: [],
    topMembers: [],
    liveRoom: null,
  };
}

const SESSION_BODY = {
  user: { id: HOST, name: "Hostly Host", email: "h@wfx.test", avatarSeed: 1 },
};

/** Route the club-card wire: session, overview, and the emotes trio. */
function managerResponder(state: {
  emotes: EmoteRow[];
  postStatus?: number;
  postBody?: Record<string, unknown>;
}): (url: string, init: RequestInit) => Response {
  return (url, init) => {
    const u = String(url);
    const method = init.method ?? "GET";
    if (u.startsWith("/api/auth/session")) return jsonResponse(SESSION_BODY);
    if (u.startsWith(EMOTES_BASE)) {
      if (method === "POST") {
        const payload = JSON.parse(String(init.body ?? "{}")) as {
          code: string;
          unicode: string;
          requiredLevel?: number;
        };
        if (state.postStatus !== undefined) {
          return jsonResponse(state.postBody ?? {}, state.postStatus);
        }
        // the frozen upsert: same code replaces, new code appends
        state.emotes = [
          ...state.emotes.filter((e) => e.code !== payload.code),
          {
            code: payload.code,
            unicode: payload.unicode,
            requiredLevel: payload.requiredLevel ?? 1,
            entitled: true,
          },
        ];
        return jsonResponse({ ...payload }, 201);
      }
      if (method === "DELETE") {
        const code = new URL(u, "https://wfx.test").searchParams.get("code") ?? "";
        state.emotes = state.emotes.filter((e) => e.code !== code);
        return jsonResponse({ ok: true });
      }
      return jsonResponse(emotesDto(state.emotes));
    }
    if (u === `/api/live-clubs/${HOST}`) return jsonResponse(clubOverviewBody());
    return jsonResponse({});
  };
}

describe("E-c ClubManagerCard emote manager — config, honest errors, no fake rows", () => {
  test("the loaded set renders glyph + :code: + Level rows, with the ADR-0011 non-monetary note", async () => {
    const state = { emotes: twoEmoteMap() };
    respond = managerResponder(state);
    await render(<ClubManagerCard />);
    await flushAll();

    const manager = q('[data-testid="emote-manager"]');
    expect(manager).not.toBeNull();
    const rows = all('[data-testid="emote-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0]!.getAttribute("data-code")).toBe("heart");
    expect(rows[0]!.textContent).toContain("❤️");
    expect(rows[0]!.textContent).toContain(":heart:");
    expect(rows[0]!.textContent).toContain("Level 1");
    expect(rows[1]!.textContent).toContain("🔥");
    expect(rows[1]!.textContent).toContain("Level 5");
    expect(
      q('button[aria-label="Delete emote :flame:"]'),
    ).not.toBeNull();
    expect(manager!.textContent).toContain(
      "Non-monetary — emotes are identity, not purchases.",
    );
  });

  test("saving POSTs the frozen payload and the list refreshes from the server (new row appears)", async () => {
    const state = { emotes: twoEmoteMap() };
    respond = managerResponder(state);
    await render(<ClubManagerCard />);
    await flushAll();

    await setInput('input[aria-label="Emote code"]', "wave");
    await setInput('input[aria-label="Emoji or character"]', "👋");
    await setInput('input[aria-label="Required club level"]', "3");
    await click("emote-save");
    await flushAll();

    const post = fetchLog.find(
      (c) => (c.init.method ?? "GET") === "POST" && c.url === EMOTES_BASE,
    );
    expect(post).toBeDefined();
    expect(post!.init.body).toBe('{"code":"wave","unicode":"👋","requiredLevel":3}');
    // the refresh is a real re-fetch, and the server's list replaced the form
    const mapGets = fetchLog.filter(
      (c) => (c.init.method ?? "GET") === "GET" && c.url.startsWith(EMOTES_BASE),
    );
    expect(mapGets.length).toBeGreaterThanOrEqual(2);
    expect(toasts).toContain("success:Emote saved");
    const rows = all('[data-testid="emote-row"]');
    expect(rows.length).toBe(3);
    expect(rows.some((r) => r.getAttribute("data-code") === "wave")).toBe(true);
    // the form reset for the next emote
    expect(
      (q('input[aria-label="Emote code"]') as unknown as HTMLInputElement).value,
    ).toBe("");
  });

  test("delete DELETEs the exact code and the refreshed list drops the row", async () => {
    const state = { emotes: twoEmoteMap() };
    respond = managerResponder(state);
    await render(<ClubManagerCard />);
    await flushAll();

    const del = q('button[aria-label="Delete emote :heart:"]') as unknown as HTMLButtonElement;
    expect(del).not.toBeNull();
    await act(async () => {
      del.click();
    });
    await flushAll();

    const deleteCall = fetchLog.find(
      (c) => (c.init.method ?? "GET") === "DELETE" && c.url.startsWith(EMOTES_BASE),
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall!.url).toBe(`${EMOTES_BASE}?code=heart`);
    expect(toasts).toContain("success:Emote deleted");
    const rows = all('[data-testid="emote-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0]!.getAttribute("data-code")).toBe("flame");
  });

  test("a 404 no-club save surfaces the server's message VERBATIM as an error toast and fakes nothing", async () => {
    const state = {
      emotes: twoEmoteMap(),
      postStatus: 404,
      postBody: { error: "not-found", message: "You don't have a fan club yet." },
    };
    respond = managerResponder(state);
    await render(<ClubManagerCard />);
    await flushAll();

    await setInput('input[aria-label="Emote code"]', "wave");
    await setInput('input[aria-label="Emoji or character"]', "👋");
    await click("emote-save");
    await flushAll();

    expect(toasts).toContain("error:You don't have a fan club yet.");
    // no row was faked — the server's list is still the only truth
    const rows = all('[data-testid="emote-row"]');
    expect(rows.length).toBe(2);
    expect(rows.some((r) => r.getAttribute("data-code") === "wave")).toBe(false);
  });
});
