/// <reference types="bun-types" />
/**
 * WFX2-P3-LC tests — the live-chat panel's send flow + the send client,
 * re-pointed to the WFX2-P36 HONEST UNSUPPORTED lane:
 *
 *  - the AU signed-out law: a guest (no WebFlix account) gets the "Sign in
 *    to chat" gate (the comment composer's "Sign in to comment" pattern —
 *    red Sign in link back to this watch page), never an editable composer;
 *  - signed-in + live: typing + Enter (and the send button) dispatch the
 *    send — which answers the HONEST typed unsupported result: posting to a
 *    live chat has NO official end-user API, and the pre-P36 path typed into
 *    youtube.com's real composer through the broker, which required
 *    BROKER_SECRET in the BROWSER bundle (it could never legitimately live
 *    client-side — the path always failed "offline"). The browser bundle
 *    imports NEITHER the broker nor any server secret: the panel clears the
 *    pending echo, restores the draft, and shows the handoff copy (chat on
 *    youtube.com) — never a fake "Sent";
 *  - the optimistic echo lifecycle is pinned with a controllable send seam
 *    (pending while the verdict is in flight, honestly cleared on it);
 *  - the retired broker-driven error states (members-only / slow mode /
 *    chat disabled / offline / verbatim broker detail) can no longer surface
 *    through the send path — the one honest state is the unsupported copy;
 *  - replay mode keeps the input hidden (posting to replayed chat is not a
 *    thing on youtube.com);
 *  - the send client's pure units: the deprecated classifier seam, echo
 *    build + reconciliation against the polled stream;
 *  - the report action's honest degradation (never a fake "reported").
 *
 * happy-dom + createRoot/act (the comment-composer test pattern) with a
 * stubbed fetch (the panel's /livechat polling — recorded so every test can
 * pin that the send path performs ZERO non-read network) + mocked
 * @/hooks/use-webflix-session + a controllable @/lib/livechat/send seam
 * (defaulting to the REAL honest module).
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
    poll: null,
    isMember: false,
    isMemberMilestone: false,
    memberMilestoneText: null,
    offsetMsec: null,
  };
}

// ---- fetch stub: the panel's livechat polling (live or replay) ----------
// every served URL is recorded: the send path must perform ZERO non-read
// network (no broker URL, no write POST — the browser bundle imports no
// server-secret seam at all).
type Frame = Record<string, unknown>;
const servedUrls: string[] = [];
let liveChatFrame: (url: string) => Frame = () => {
  throw new Error("frame router unset");
};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL | Request) => {
  const u = String(url instanceof Request ? url.url : url);
  if (!u.startsWith(BASE)) throw new Error(`unexpected fetch ${u}`);
  servedUrls.push(u);
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

// ---- the send seam: the REAL honest module, with a controllable
// sendLiveChatMessage for pinning the in-flight echo lifecycle. The default
// is the real function — every behavior test below exercises the honest
// unsupported verdict unless it explicitly holds the promise. NOTE: the
// real function must be CAPTURED BEFORE mock.module (bun patches the live
// module binding in place, so the namespace's property would otherwise
// point back at the mock — infinite recursion).
const realSend = await import("@/lib/livechat/send");
const realSendFn = realSend.sendLiveChatMessage;
let sendImpl: typeof realSendFn = realSendFn;
mock.module("@/lib/livechat/send", () => ({
  ...realSend,
  sendLiveChatMessage: (videoId: string, message: string) => sendImpl(videoId, message),
}));

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
/** the honest result type (the real module's contract). */
type LiveChatSendResult = Awaited<ReturnType<typeof realSendFn>>;
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
  // the REAL honest send function is the default seam — tests only override
  // it to hold the in-flight verdict (the echo lifecycle pin)
  sendImpl = realSendFn;
  servedUrls.length = 0;
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

// ---- the send flow (the honest unsupported lane) ---------------------------
describe("LiveChatPanel — the send flow (the honest unsupported lane)", () => {
  test("Enter sends → the honest unsupported verdict: echo cleared, draft restored, the handoff copy shows", async () => {
    await renderPanel();
    await typeIntoChat("hello from the test");
    expect(sendButton()!.disabled).toBe(false);
    await pressEnter();
    // the honest verdict: the pending echo is cleared (never a fake "Sent")…
    expect(echoRows()).toHaveLength(0);
    expect(bodyText()).not.toContain("Sending…");
    expect(bodyText()).not.toContain("Sent");
    // …the draft is restored for retry (youtube.com keeps the text)…
    expect(chatInput()!.value).toBe("hello from the test");
    // …and the honest handoff copy shows
    expect(errorAlert()).not.toBeNull();
    expect(errorAlert()!.textContent).toContain(
      "Live chat posting isn't supported through the official API"
    );
    expect(errorAlert()!.textContent).toContain("chat on youtube.com");
    // the browser send path performs ZERO non-read network (no broker, no
    // server-secret seam — the pre-P36 client-side broker call is gone)
    expect(servedUrls.every((u) => u.startsWith(BASE))).toBe(true);
  });

  test("the send button also sends (both affordances, one honest verdict each)", async () => {
    await renderPanel();
    await typeIntoChat("via the button");
    await act(async () => {
      sendButton()!.click();
    });
    await act(async () => {
      await sleep(10);
    });
    // the same honest unsupported verdict through the button affordance
    expect(echoRows()).toHaveLength(0);
    expect(errorAlert()).not.toBeNull();
    expect(errorAlert()!.textContent).toContain("chat on youtube.com");
    expect(chatInput()!.value).toBe("via the button");
  });

  test("optimistic echo: pending while the verdict is in flight, honestly cleared on it — never a fake 'Sent'", async () => {
    await renderPanel();
    let release: ((v: LiveChatSendResult) => void) | null = null;
    sendImpl = () =>
      new Promise<LiveChatSendResult>((res) => {
        release = res;
      });
    await typeIntoChat("optimistic message");
    await pressEnter();
    // the verdict is in flight — the echo is already visible, pending
    expect(bodyText()).toContain("optimistic message");
    expect(bodyText()).toContain("Sending…");
    const pending = echoRows();
    expect(pending).toHaveLength(1);
    expect(pending[0].getAttribute("data-status")).toBe("pending");
    // the draft cleared while the send was in flight
    expect(chatInput()!.value).toBe("");
    // the REAL honest unsupported verdict lands → the echo clears (the
    // reconcile path: a message that never arrives is never claimed "Sent")
    const verdict = await realSendFn(VIDEO, "optimistic message");
    await act(async () => {
      release!(verdict);
    });
    await act(async () => {
      await sleep(10);
    });
    expect(echoRows()).toHaveLength(0);
    expect(bodyText()).not.toContain("Sending…");
    expect(bodyText()).not.toContain("Sent");
    expect(errorAlert()).not.toBeNull();
    expect(errorAlert()!.textContent).toContain("chat on youtube.com");
    // the draft is restored for retry
    expect(chatInput()!.value).toBe("optimistic message");
  });

  test("failure reconciliation: the echo clears, the draft is restored, the honest error shows — and a retry re-arms", async () => {
    await renderPanel();
    await typeIntoChat("too soon");
    await pressEnter();
    // the pending mark is cleared (the echo row is GONE)…
    expect(echoRows()).toHaveLength(0);
    expect(bodyText()).not.toContain("Sending…");
    // …the honest copy shows (role=alert)…
    expect(errorAlert()).not.toBeNull();
    expect(errorAlert()!.getAttribute("role")).toBe("alert");
    expect(errorAlert()!.textContent).toContain(
      "Live chat posting isn't supported through the official API — chat on youtube.com"
    );
    // …the draft is restored for retry…
    expect(chatInput()!.value).toBe("too soon");
    // …and the composer stays usable (the honest state is recoverable)
    expect(sendButton()!.disabled).toBe(false);
  });
});

// ---- the one honest error state (the retired broker states pinned gone) ----
describe("LiveChatPanel — the honest error state is the unsupported handoff", () => {
  test("the one send-failure state: the exact unsupported copy — the retired broker-driven states never surface", async () => {
    await renderPanel();
    await typeIntoChat("anyone there?");
    await pressEnter();
    expect(errorAlert()).not.toBeNull();
    // the component copy, matched exactly
    expect(errorAlert()!.textContent).toBe(
      "Live chat posting isn't supported through the official API — chat on youtube.com"
    );
    // the pre-P36 broker-driven states rode the retired client-side broker
    // call — none of them can surface through the send path anymore
    expect(bodyText()).not.toContain("Chat is available to members only");
    expect(bodyText()).not.toContain("Slow mode is on");
    expect(bodyText()).not.toContain("Chat is disabled for this live stream");
    expect(bodyText()).not.toContain("action backend offline");
    expect(bodyText()).not.toContain("Message not sent (");
  });

  test("the real send client answers the honest typed unsupported verdict (never a throw, any input)", async () => {
    const r1 = await realSendFn(VIDEO, "hello");
    const r2 = await realSendFn("other-video", "");
    const expected = {
      ok: false,
      error: {
        kind: "unsupported",
        copy: "Live chat posting isn't supported through the official API — chat on youtube.com",
      },
    } as const;
    expect(r1).toEqual(expected);
    expect(r2).toEqual(expected);
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

  test("replay + signed-in: still no composer, no send attempted", async () => {
    useReplayFrame();
    await renderPanel();
    expect(chatInput()).toBeNull();
    expect(sendButton()).toBeNull();
    // no send ever dispatched, and no send-failure state either — the read
    // poll is the only traffic
    expect(errorAlert()).toBeNull();
    expect(servedUrls.every((u) => u.startsWith(BASE))).toBe(true);
  });
});

// ---- P24-SEND (G8): the paid-send disclosure (the honest-degradation law).
// youtube.com's signed-in composer carries the $ entry (the Super Chat /
// Super Sticker purchase panel) + Super Thanks on the watch page — PAID
// checkout surfaces. WebFlix has NO payment rail and never fabricates one:
// the paid interactions stay DISPLAY-only (the mapper + message rows —
// display parity pinned by the livechat-mapping suite) and the signed-in
// composer area carries the honest reason (role=note). Measured basis:
// the logged-out live chat (yOXXI7_crys) carries NO Super Chat entry in
// the header/composer; the logged-out watch page carries no Super Thanks
// shapes — the send affordances are honestly absent.
describe("LiveChatPanel — the paid-send disclosure (P24-SEND G8)", () => {
  const paidNote = () => q('[role="note"][data-testid="chat-paid-send-note"]');

  test("signed-in + live: the composer area carries the paid-send note — read-only display, purchases on YouTube's checkout", async () => {
    await renderPanel();
    const note = paidNote();
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain("Super Chats, Super Stickers and Super Thanks");
    expect(note!.textContent).toContain("purchases happen on YouTube's checkout");
    // the honest-degradation form: NO $ entry, NO purchase panel next to the
    // composer (never a fabricated payment affordance)
    expect(host!.textContent ?? "").not.toContain("Send a Super Chat");
    expect(host!.textContent ?? "").not.toContain("$");
  });

  test("replay hides the disclosure (the note belongs to the live send surface only)", async () => {
    useReplayFrame();
    await renderPanel();
    expect(paidNote()).toBeNull();
  });

  test("the guest gate hides the disclosure too (the existing honest form stands)", async () => {
    sessionState = { status: "unauthenticated", user: null };
    await renderPanel();
    expect(paidNote()).toBeNull();
    expect(bodyText()).toContain("Sign in to chat");
  });
});

// ---- the send client's pure units ----------------------------------------------
describe("livechat send client — classification + echo reconciliation", () => {
  // classifyLiveChatSendError is the @deprecated WFX2-P36 compat seam (kept
  // for the test re-point): its parameter is the BrokerError's STRUCTURAL
  // shape — plain objects here, no broker import anywhere in the test file.
  test("classifyLiveChatSendError maps the broker taxonomy to the honest states (the deprecated compat seam)", () => {
    expect(classifyLiveChatSendError({ kind: "offline", message: "fetch failed" })).toEqual({
      kind: "offline",
      copy: "action backend offline — the lead's broker must be running",
    });
    expect(
      classifyLiveChatSendError({ kind: "action-failed", message: "chat-members-only" })
    ).toEqual({ kind: "members-only", copy: LIVE_CHAT_ERROR_COPY.membersOnly });
    expect(
      classifyLiveChatSendError({ kind: "action-failed", message: "chat-slow-mode" })
    ).toEqual({ kind: "slow-mode", copy: LIVE_CHAT_ERROR_COPY.slowMode });
    expect(
      classifyLiveChatSendError({ kind: "action-failed", message: "chat-disabled" })
    ).toEqual({ kind: "chat-disabled", copy: LIVE_CHAT_ERROR_COPY.chatDisabled });
    expect(
      classifyLiveChatSendError({ kind: "action-failed", message: "page-script-error: TypeError: x" })
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
