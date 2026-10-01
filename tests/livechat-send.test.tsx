/// <reference types="bun-types" />
/**
 * WFX2-P3-LC tests — the live-chat panel's send flow + the send client:
 *
 *  - the AU signed-out law: a guest (no WebFlix account) gets the "Sign in
 *    to chat" gate (the comment composer's "Sign in to comment" pattern —
 *    red Sign in link back to this watch page), never an editable composer;
 *  - signed-in + live: typing + Enter (and the send button) dispatch the
 *    broker action (mocked brokerAction — "live-chat-send" with {videoId,
 *    message});
 *  - the optimistic echo: the message renders immediately marked pending
 *    ("Sending…"), reconciled by the broker result (ok → "Sent"; failure →
 *    the echo clears, the draft is restored, the honest error copy shows);
 *  - the honest error states render youtube.com's own copy: members-only,
 *    slow mode, chat disabled (+ the broker-offline state);
 *  - replay mode keeps the input hidden (posting to replayed chat is not a
 *    thing on youtube.com);
 *  - the send client's pure units: error classification, echo build +
 *    reconciliation against the polled stream;
 *  - the report action's honest degradation (never a fake "reported").
 *
 * happy-dom + createRoot/act (the comment-composer test pattern) with a
 * stubbed fetch (the panel's /livechat polling) + mocked
 * @/hooks/use-webflix-session + mocked @/lib/broker.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test, mock } from "bun:test";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { LiveChatMessageDTO } from "@/lib/youtube/livechat";

// ---- happy-dom as the global DOM ----
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

const VIDEO = "LIVE1234567";
const BASE = `/api/videos/${VIDEO}/livechat`;

/** Minimal live-chat message fixture (the DTO the hook consumes). */
function lmsg(id: string, body: string): LiveChatMessageDTO {
  return {
    id,
    author: { id: `a-${id}`, name: `Author ${id}`, avatarUrl: null, badges: [], memberSinceText: null },
    body,
    timestampUsec: "0",
    kind: "text",
    isSuperChat: false,
    superChat: null,
    isMember: false,
    isMemberMilestone: false,
    memberMilestoneText: null,
    offsetMsec: null,
  };
}

// ---- fetch stub: the panel's livechat polling (live or replay) ----------
type Frame = Record<string, unknown>;
let liveChatFrame: (url: string) => Frame = () => {
  throw new Error("frame router unset");
};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request) => {
  const u = String(url instanceof Request ? url.url : url);
  if (!u.startsWith(BASE)) throw new Error(`unexpected fetch ${u}`);
  const body = liveChatFrame(u);
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as unknown as typeof fetch;

function useLiveFrame() {
  liveChatFrame = () => ({
    chatAvailable: true,
    mode: "live",
    isReplay: false,
    pollMs: 60_000, // beyond any test's life — no scheduled poll fires
    participants: 12,
    nextToken: "live-tok-1",
    messages: [lmsg("m1", "first!"), lmsg("m2", "hello stream")],
  });
}

function useReplayFrame() {
  liveChatFrame = () => ({
    chatAvailable: true,
    mode: "replay",
    isReplay: true,
    pollMs: 0,
    participants: null,
    nextToken: null,
    messages: [lmsg("r1", "replay row")],
  });
}

// ---- the session mock (the P2-AU hook the panel reads) -------------------
type SessionState = { status: "loading" | "authenticated" | "unauthenticated"; user: unknown };
let sessionState: SessionState = { status: "authenticated", user: null };
mock.module("@/hooks/use-webflix-session", () => ({
  useWebFlixSession: () => sessionState,
}));

// ---- the broker mock (the panel's send path runs through it) -------------
type BrokerCall = { kind: string; target: Record<string, unknown>; payload: Record<string, unknown> };
const brokerCalls: BrokerCall[] = [];
let brokerActionImpl: (call: BrokerCall) => Promise<unknown> = async () => ({
  ok: true,
  verified: true,
  detail: { messageId: "yt-msg-1" },
});

/** The mock mirrors src/lib/broker.ts's BrokerError (the class send.ts
 * instanceof-checks — same module instance, so the check holds). */
class BrokerErrorMock extends Error {
  kind: "offline" | "action-failed" | "unauthorized" | "bad-request";
  status: number;
  detail?: unknown;
  constructor(
    kind: "offline" | "action-failed" | "unauthorized" | "bad-request",
    message: string,
    status = 502,
    detail?: unknown
  ) {
    super(message);
    this.name = "BrokerError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

const BROKER_OFFLINE_MESSAGE = "action backend offline — the lead's broker must be running";
mock.module("@/lib/broker", () => {
  const brokerAction = (kind: string, target: Record<string, unknown>, payload: Record<string, unknown>) => {
    brokerCalls.push({ kind, target, payload });
    return brokerActionImpl({ kind, target, payload });
  };
  return {
    BROKER_OFFLINE_MESSAGE,
    BrokerError: BrokerErrorMock,
    brokerAction,
    // the additive helper's contract, mirrored 1:1 (thin brokerAction wrap)
    brokerLiveChatSend: (videoId: string, message: string) =>
      brokerAction("live-chat-send", { videoId }, { message }),
  };
});

const { LiveChatPanel } = await import("@/components/watch/live-chat-panel");
const { LiveChatMessage, LiveChatReportDialog, CHAT_REPORT_REASONS } = await import(
  "@/components/watch/live-chat-message"
);
const {
  classifyLiveChatSendError,
  buildLiveChatEcho,
  reconcileEchoes,
  LIVE_CHAT_ERROR_COPY,
} = await import("@/lib/livechat/send");
const { reportLiveChatMessage, LIVE_CHAT_REPORT_UNAVAILABLE } = await import("@/lib/livechat/report");

// ---- harness ---------------------------------------------------------------
let root: Root | null = null;
let host: ReturnType<typeof win.document.createElement> | null = null;

const q = (sel: string): HTMLElement | null =>
  host ? (host.querySelector(sel) as unknown as HTMLElement | null) : null;
const bodyText = () => win.document.body.textContent ?? "";
const chatInput = () => q('input[aria-label="Chat message"]') as HTMLInputElement | null;
const sendButton = () => q('button[aria-label="Send message"]') as HTMLButtonElement | null;
const errorAlert = () => q('[role="alert"][data-testid="chat-send-error"]');
const echoRows = () =>
  host ? Array.from(host.querySelectorAll('[data-testid="chat-echo"]')) : [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function renderPanel() {
  host = win.document.createElement("div");
  win.document.body.appendChild(host);
  root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
  await act(async () => {
    root!.render(<LiveChatPanel videoId={VIDEO} />);
  });
  // let the bootstrap fetch + the hook's state settle into "live"/"replay"
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await sleep(10);
    });
  }
}

/** type into the chat input the way a user would (the comment-composer
 * test's value-tracker pattern: focusin → prototype-setter → keyup). */
async function typeIntoChat(text: string) {
  const el = chatInput();
  if (!el) throw new Error("chat input missing");
  await act(async () => {
    el.dispatchEvent(new Event("focusin", { bubbles: true }));
  });
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(el, text);
  await act(async () => {
    el.dispatchEvent(new Event("keyup", { bubbles: true }));
  });
}

async function pressEnter() {
  const el = chatInput();
  if (!el) throw new Error("chat input missing");
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  await act(async () => {
    await sleep(10);
  });
}

beforeEach(() => {
  brokerCalls.length = 0;
  brokerActionImpl = async () => ({ ok: true, verified: true, detail: { messageId: "yt-msg-1" } });
  sessionState = {
    status: "authenticated",
    user: { id: "u1", email: "ada@webflix.test", displayName: "Ada", avatarSeed: 10 },
  };
  useLiveFrame();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

// ---- the AU signed-out law: the guest gate ---------------------------------
describe("LiveChatPanel — guest gate (the AU signed-out law)", () => {
  test("guest gets the 'Sign in to chat' gate with the redirect-back Sign in link — never a composer", async () => {
    sessionState = { status: "unauthenticated", user: null };
    await renderPanel();
    expect(bodyText()).toContain("Sign in to chat");
    const link = q("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe(`/signin?redirect=${encodeURIComponent(`/watch/${VIDEO}`)}`);
    expect(link!.textContent?.trim()).toBe("Sign in");
    // never a fake write surface for a guest
    expect(chatInput()).toBeNull();
    expect(sendButton()).toBeNull();
  });

  test("signed-in + live: the composer renders (input + send button)", async () => {
    await renderPanel();
    expect(chatInput()).not.toBeNull();
    expect(sendButton()).not.toBeNull();
    // the send button is disabled until there is text
    expect(sendButton()!.disabled).toBe(true);
  });
});

// ---- the send flow (mocked brokerAction) ------------------------------------
describe("LiveChatPanel — the send flow (mocked brokerAction)", () => {
  test("Enter sends: brokerAction('live-chat-send', {videoId}, {message})", async () => {
    await renderPanel();
    await typeIntoChat("hello from the test");
    expect(sendButton()!.disabled).toBe(false);
    await pressEnter();
    expect(brokerCalls).toHaveLength(1);
    expect(brokerCalls[0]).toEqual({
      kind: "live-chat-send",
      target: { videoId: VIDEO },
      payload: { message: "hello from the test" },
    });
  });

  test("the send button also sends (both affordances, one dispatch each)", async () => {
    await renderPanel();
    await typeIntoChat("via the button");
    await act(async () => {
      sendButton()!.click();
    });
    await act(async () => {
      await sleep(10);
    });
    expect(brokerCalls).toHaveLength(1);
    expect(brokerCalls[0].payload).toEqual({ message: "via the button" });
  });

  test("optimistic echo: pending immediately, 'Sent' when the broker verifies", async () => {
    await renderPanel();
    let release: ((v: unknown) => void) | null = null;
    brokerActionImpl = () =>
      new Promise((res) => {
        release = res;
      });
    await typeIntoChat("optimistic message");
    await pressEnter();
    // the broker call is in flight — the echo is already visible, pending
    expect(brokerCalls).toHaveLength(1);
    expect(bodyText()).toContain("optimistic message");
    expect(bodyText()).toContain("Sending…");
    const pending = echoRows();
    expect(pending).toHaveLength(1);
    expect(pending[0].getAttribute("data-status")).toBe("pending");
    // the draft cleared while the send was in flight
    expect(chatInput()!.value).toBe("");
    // the broker verdict lands → the echo flips to sent (pending mark clears)
    await act(async () => {
      release!({ ok: true, verified: true, detail: { messageId: "yt-row-77" } });
    });
    await act(async () => {
      await sleep(10);
    });
    expect(bodyText()).not.toContain("Sending…");
    expect(bodyText()).toContain("Sent");
    expect(echoRows()[0].getAttribute("data-status")).toBe("sent");
    // no error state
    expect(errorAlert()).toBeNull();
  });

  test("failure reconciliation: the echo clears, the draft is restored, the honest error shows", async () => {
    await renderPanel();
    brokerActionImpl = async () =>
      new BrokerErrorMock("action-failed", "chat-slow-mode", 502, { notice: "again in 4" });
    await typeIntoChat("too soon");
    await pressEnter();
    // the pending mark is cleared (the echo row is GONE)…
    expect(echoRows()).toHaveLength(0);
    expect(bodyText()).not.toContain("Sending…");
    // …the honest platform copy shows…
    expect(errorAlert()).not.toBeNull();
    expect(errorAlert()!.textContent).toContain("Slow mode is on");
    // …and the draft is restored for retry (youtube.com keeps the text)
    expect(chatInput()!.value).toBe("too soon");
  });
});

// ---- the three honest error states (+ offline) -------------------------------
describe("LiveChatPanel — the honest error states render youtube.com's own copy", () => {
  const cases: { error: string; kind: string; copy: string }[] = [
    { error: "chat-members-only", kind: "action-failed", copy: "Chat is available to members only" },
    { error: "chat-slow-mode", kind: "action-failed", copy: "Slow mode is on" },
    { error: "chat-disabled", kind: "action-failed", copy: "Chat is disabled for this live stream" },
  ];

  for (const c of cases) {
    test(`${c.error} → "${c.copy}"`, async () => {
      await renderPanel();
      brokerActionImpl = async () => new BrokerErrorMock("action-failed", c.error, 502);
      await typeIntoChat(`msg for ${c.error}`);
      await pressEnter();
      expect(errorAlert()).not.toBeNull();
      expect(errorAlert()!.textContent).toContain(c.copy);
      expect(bodyText()).not.toContain("Sending…");
    });
  }

  test("broker offline → the established honest offline message", async () => {
    await renderPanel();
    brokerActionImpl = async () => new BrokerErrorMock("offline", BROKER_OFFLINE_MESSAGE, 502);
    await typeIntoChat("anyone there?");
    await pressEnter();
    expect(errorAlert()).not.toBeNull();
    expect(errorAlert()!.textContent).toContain(BROKER_OFFLINE_MESSAGE);
  });

  test("unknown broker errors surface verbatim (honest detail, never swallowed)", async () => {
    await renderPanel();
    brokerActionImpl = async () =>
      new BrokerErrorMock("action-failed", "live-chat-composer-not-found", 502);
    await typeIntoChat("where is chat?");
    await pressEnter();
    expect(errorAlert()!.textContent).toContain("Message not sent (live-chat-composer-not-found)");
  });
});

// ---- replay mode keeps the input hidden ---------------------------------------
describe("LiveChatPanel — replay mode (chat replay is read-only)", () => {
  test("replay: no composer, no guest gate — posting to replayed chat is not a thing", async () => {
    useReplayFrame();
    sessionState = { status: "unauthenticated", user: null };
    await renderPanel();
    expect(bodyText()).toContain("Chat replay");
    expect(chatInput()).toBeNull();
    expect(sendButton()).toBeNull();
    expect(bodyText()).not.toContain("Sign in to chat");
  });

  test("replay + signed-in: still no composer", async () => {
    useReplayFrame();
    await renderPanel();
    expect(chatInput()).toBeNull();
    expect(sendButton()).toBeNull();
    expect(brokerCalls).toHaveLength(0);
  });
});

// ---- the send client's pure units ----------------------------------------------
describe("livechat send client — classification + echo reconciliation", () => {
  test("classifyLiveChatSendError maps the broker taxonomy to the honest states", () => {
    expect(classifyLiveChatSendError(new BrokerErrorMock("offline", "fetch failed", 502))).toEqual({
      kind: "offline",
      copy: BROKER_OFFLINE_MESSAGE,
    });
    expect(
      classifyLiveChatSendError(new BrokerErrorMock("action-failed", "chat-members-only", 502))
    ).toEqual({ kind: "members-only", copy: LIVE_CHAT_ERROR_COPY.membersOnly });
    expect(
      classifyLiveChatSendError(new BrokerErrorMock("action-failed", "chat-slow-mode", 502))
    ).toEqual({ kind: "slow-mode", copy: LIVE_CHAT_ERROR_COPY.slowMode });
    expect(
      classifyLiveChatSendError(new BrokerErrorMock("action-failed", "chat-disabled", 502))
    ).toEqual({ kind: "chat-disabled", copy: LIVE_CHAT_ERROR_COPY.chatDisabled });
    expect(
      classifyLiveChatSendError(
        new BrokerErrorMock("action-failed", "page-script-error: TypeError: x", 502)
      )
    ).toEqual({ kind: "failed", copy: "Message not sent (page-script-error: TypeError: x)" });
  });

  test("buildLiveChatEcho: local id namespace, pending status", () => {
    const e = buildLiveChatEcho("hi");
    expect(e.id.startsWith("wfx2-echo-")).toBe(true);
    expect(e.body).toBe("hi");
    expect(e.status).toBe("pending");
  });

  test("reconcileEchoes: a sent echo whose body has streamed is dropped; pending echoes stay", () => {
    const pending = { ...buildLiveChatEcho("in flight"), status: "pending" as const };
    const sentStreamed = { ...buildLiveChatEcho("already landed"), status: "sent" as const };
    const sentPending = { ...buildLiveChatEcho("render lag"), status: "sent" as const };
    const streamed = [lmsg("s1", "already landed"), lmsg("s2", "unrelated")];
    const kept = reconcileEchoes([pending, sentStreamed, sentPending], streamed);
    expect(kept.map((e) => e.body)).toEqual(["in flight", "render lag"]);
  });
});

// ---- the report action's honest degradation -------------------------------------
describe("livechat report action — honest degradation", () => {
  test("never claims a report was filed while the platform's chat report DOM is unreachable", async () => {
    const r = await reportLiveChatMessage({
      videoId: VIDEO,
      messageId: "yt-row-1",
      body: "spammy text",
      reason: "Spam or misleading",
    });
    expect(r.ok).toBe(false);
    expect(r.message).toBe(LIVE_CHAT_REPORT_UNAVAILABLE);
    expect(r.message).toContain("nothing was filed");
    expect(r.reason).toBe("Spam or misleading");
  });
});

// ---- the report dialog (the comment-report-dialog idiom + honest outcome) -------
describe("LiveChatReportDialog — the report affordance's honest outcome", () => {
  test("reason rows → Report → the honest degradation copy (never a fake 'reported')", async () => {
    host = win.document.createElement("div");
    win.document.body.appendChild(host);
    root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
    await act(async () => {
      root!.render(
        <LiveChatReportDialog
          open
          onOpenChange={() => {}}
          message={lmsg("yt-row-9", "the reported chat text")}
          videoId={VIDEO}
        />
      );
    });
    await act(async () => {
      await sleep(10);
    });
    // radix portals into document.body — assert against the document
    const radios = Array.from(
      win.document.querySelectorAll('[role="radio"]')
    ) as unknown as HTMLElement[];
    expect(radios).toHaveLength(CHAT_REPORT_REASONS.length);
    await act(async () => {
      radios[0].click(); // select "Spam or misleading"
    });
    const reportBtn = Array.from(win.document.querySelectorAll("button")).find((b) =>
      /^(report)$/i.test((b.textContent ?? "").trim())
    );
    expect(reportBtn).toBeDefined();
    await act(async () => {
      reportBtn!.click();
    });
    await act(async () => {
      await sleep(10);
    });
    const outcome = win.document.querySelector('[data-testid="chat-report-outcome"]');
    expect(outcome).not.toBeNull();
    expect(outcome!.textContent).toContain(LIVE_CHAT_REPORT_UNAVAILABLE);
    expect(win.document.body.textContent).not.toContain("Thanks for reporting");
  });

  test("rows without a videoId render with NO context-menu affordance (additive, opt-in)", async () => {
    host = win.document.createElement("div");
    win.document.body.appendChild(host);
    root = createRoot(host as unknown as Parameters<typeof createRoot>[0]);
    await act(async () => {
      root!.render(
        <LiveChatMessage message={lmsg("yt-row-10", "a plain row")} showTimestamps={false} />
      );
    });
    await act(async () => {
      await sleep(10);
    });
    expect(bodyText()).toContain("a plain row");
    // no context-menu trigger content rendered (the affordance is opt-in)
    expect(win.document.querySelectorAll("[data-slot='context-menu-trigger']")).toHaveLength(0);
  });
});
